import { getTool, validateToolParams, type TaskDTO, type TaskStatus } from '@retouch/shared';
import { config } from '../config';
import { err, normalizeError } from '../lib/errors';
import { wakeWorker } from '../queue/signal';
import { hub } from '../lib/sse';
import { findImage } from '../store/images';
import {
  cancelQueued,
  findTask,
  insertTask,
  listTasks,
  markFailed,
  markRefunded,
  markSucceeded,
  requeue,
  setProgress,
  setProvider,
  taskParams,
  type TaskRow,
} from '../store/tasks';
import { getRunner } from '../tools/runners';
import { assertCanSubmit, getQuota, precount, refund, settle } from './quota';

function parseOutput(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toTaskDTO(row: TaskRow): TaskDTO {
  const tool = getTool(row.tool);
  return {
    id: row.id,
    tool: row.tool,
    title: tool?.title ?? row.tool,
    status: row.status,
    progress: row.progress,
    documentId: row.document_id,
    imageId: row.image_id,
    resultImageId: row.result_image_id,
    provider: row.provider,
    model: row.model,
    costYuan: row.cost_yuan,
    error: row.error,
    errorCode: row.error_code,
    output: parseOutput(row.output),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function assertRefsOwned(userId: string, toolName: string, params: Record<string, unknown>): void {
  const tool = getTool(toolName)!;
  // 只看"有没有给图"，归属校验在下面统一做；imageIds 是 unknown，不能直接当下标取
  const firstOfList = Array.isArray(params.imageIds)
    ? params.imageIds.find((x): x is string => typeof x === 'string' && x.length > 0)
    : undefined;
  const imageId = typeof params.imageId === 'string' && params.imageId ? params.imageId : firstOfList;
  if (tool.needsImage && !imageId) throw err('NEEDS_IMAGE', '这个功能需要先有一张图');
  if (tool.needsMask && !params.maskImageId) throw err('NEEDS_MASK', '请先在画布上涂抹或框选要处理的区域');

  const ids: string[] = [];
  for (const key of ['imageId', 'maskImageId', 'backgroundImageId']) {
    if (typeof params[key] === 'string') ids.push(params[key]);
  }
  if (Array.isArray(params.imageIds)) ids.push(...(params.imageIds as string[]));
  for (const id of ids) {
    const img = findImage(id);
    if (!img || img.user_id !== userId) throw err('NOT_FOUND', `图片 ${id} 不存在`);
  }
}

/** 提交一个服务端任务：校验 → 配额 → 落库 → 预扣 → 排队 → 通知 */
export function submitTask(input: {
  userId: string;
  tool: string;
  params: Record<string, unknown>;
  documentId?: string | null;
  planId?: string | null;
  stepIdx?: number | null;
}): { task: TaskDTO; row: TaskRow } {
  const tool = getTool(input.tool);
  if (!tool) throw err('TOOL_UNKNOWN', `没有这个工具：${input.tool}`);
  if (tool.executor !== 'server') {
    throw err('BAD_REQUEST', `${tool.title} 在浏览器本地执行，不需要提交任务`);
  }

  // 先做业务前置检查（缺图/缺选区/图不属于你），再校验参数细节，
  // 否则 zod 会先报 "maskImageId expected string"，用户看不懂
  assertRefsOwned(input.userId, input.tool, input.params);

  const checked = validateToolParams(input.tool, input.params);
  if (!checked.ok) {
    throw err('TOOL_PARAMS_INVALID', `${tool.title} 的参数不对：${checked.issues.join('；')}`, checked.issues);
  }
  assertCanSubmit(input.userId);

  const row = insertTask({
    userId: input.userId,
    tool: input.tool,
    params: checked.value,
    documentId: input.documentId ?? null,
    planId: input.planId ?? null,
    stepIdx: input.stepIdx ?? null,
    imageId: typeof checked.value.imageId === 'string' ? checked.value.imageId : null,
    maskImageId: typeof checked.value.maskImageId === 'string' ? checked.value.maskImageId : null,
  });
  precount(input.userId);
  const dto = toTaskDTO(row);
  hub.publish(input.userId, { type: 'task.queued', task: dto });
  hub.publish(input.userId, { type: 'quota.changed', quota: getQuota(input.userId) });
  wakeWorker();
  return { task: dto, row };
}

export class TaskTimeout extends Error {}

/**
 * 超时不再只是"不等了"：以前 withTimeout 只 reject，runner 与它背后的 fetch/poll 会继续把
 * 上游调用跑完 —— 钱花了、结果丢掉、并发槽还提前释放了。现在把 signal 交下去真的掐断。
 */
export function withAbort<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ac.abort();
      reject(new TaskTimeout());
    }, ms);
    run(ac.signal).then(
      (v) => {
        clearTimeout(timer);
        // 迟到一步的成功不再算数：结果已经不该落库
        if (ac.signal.aborted) reject(new TaskTimeout());
        else resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e), { cause: e }));
      },
    );
  });
}

/** 一次预扣只退一次：charged 0→2 的翻转就是幂等锁 */
function refundPrecount(taskId: string, userId: string): void {
  if (markRefunded(taskId)) refund(userId);
}

/** worker 的执行体。成功/失败都会推 SSE */
export async function executeTask(row: TaskRow): Promise<void> {
  const runner = getRunner(row.tool);
  if (!runner) {
    markFailed(row.id, 'TOOL_UNKNOWN', `工具 ${row.tool} 没有服务端实现`);
    publishFinal(row.user_id, row.id);
    return;
  }

  let lastPublish = 0;
  const onProgress = (p: number) => {
    const cur = Math.max(0.05, Math.min(0.95, p));
    const now = Date.now();
    if (now - lastPublish < 400 && cur < 0.9) return;
    lastPublish = now;
    setProgress(row.id, cur);
    const fresh = findTask(row.id);
    if (fresh) hub.publish(row.user_id, { type: 'task.progress', task: toTaskDTO(fresh), progress: cur });
  };

  try {
    const result = await withAbort(
      (signal) =>
        runner({ userId: row.user_id, taskId: row.id, documentId: row.document_id, onProgress, signal }, taskParams(row)),
      config.TASK_TIMEOUT_MS,
    );
    setProvider(row.id, result.provider, result.model);
    markSucceeded(row.id, result.resultImageId ?? null, result.costYuan, result.output);
    settle(row.user_id, result.costYuan);
    publishFinal(row.user_id, row.id);
    hub.publish(row.user_id, { type: 'quota.changed', quota: getQuota(row.user_id) });
  } catch (e) {
    const ne =
      e instanceof TaskTimeout
        ? err('PROVIDER_TIMEOUT', `模型超时（> ${Math.round(config.TASK_TIMEOUT_MS / 1000)}s），已取消上游请求，可重试`)
        : normalizeError(e);
    const retriable = ne.code === 'PROVIDER_TIMEOUT' || ne.code === 'PROVIDER_UNAVAILABLE';
    const willRetry = retriable && row.attempts <= config.TASK_MAX_RETRY;
    markFailed(row.id, ne.code, ne.message, { requeue: willRetry });
    if (!willRetry) refundPrecount(row.id, row.user_id);
    publishFinal(row.user_id, row.id);
    if (willRetry) wakeWorker();
  }
}

function publishFinal(userId: string, taskId: string): void {
  const fresh = findTask(taskId);
  if (!fresh) return;
  const task = toTaskDTO(fresh);
  hub.publish(userId, { type: fresh.status === 'succeeded' ? 'task.succeeded' : 'task.failed', task });
}

export function listUserTasks(userId: string, opts: { status?: TaskStatus[]; limit?: number; before?: string } = {}): TaskDTO[] {
  return listTasks(userId, opts).map(toTaskDTO);
}

export function requireTask(id: string, userId: string): TaskRow {
  const row = findTask(id);
  if (!row || row.user_id !== userId) throw err('NOT_FOUND', `任务 ${id} 不存在`);
  return row;
}

export function retryTask(id: string, userId: string): TaskDTO {
  const row = requireTask(id, userId);
  if (row.status !== 'failed') throw err('BAD_REQUEST', '只有失败的任务能重试');
  assertCanSubmit(userId);
  requeue(id, userId);
  precount(userId);
  const fresh = findTask(id)!;
  hub.publish(userId, { type: 'task.queued', task: toTaskDTO(fresh) });
  wakeWorker();
  return toTaskDTO(fresh);
}

export function cancelTask(id: string, userId: string): TaskDTO {
  requireTask(id, userId);
  if (!cancelQueued(id, userId)) throw err('BAD_REQUEST', '任务已在执行或已结束，无法取消');
  refundPrecount(id, userId);
  const fresh = findTask(id)!;
  hub.publish(userId, { type: 'task.failed', task: toTaskDTO(fresh) });
  hub.publish(userId, { type: 'quota.changed', quota: getQuota(userId) });
  return toTaskDTO(fresh);
}
