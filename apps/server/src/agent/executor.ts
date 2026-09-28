import { getTool, type PlanDTO } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { log } from '../lib/log';
import { newId, newRequestId } from '../lib/ids';
import { failWait, settleWait, waitFor } from '../lib/pending';
import { hub } from '../lib/sse';
import { claimPlan, findPlan, planSteps, releasePlan, savePlan, type PlanRow, type StepRecord } from '../store/plans';
import { findTask, type TaskRow } from '../store/tasks';
import { submitTask } from '../services/tasks';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toPlanDTO(row: PlanRow): PlanDTO {
  return {
    id: row.id,
    documentId: row.document_id,
    userMessage: row.user_message,
    status: row.status,
    planner: row.planner,
    steps: planSteps(row).map((s) => ({
      idx: s.idx,
      tool: s.tool,
      title: s.title,
      executor: s.executor,
      params: s.params,
      deps: s.deps,
      reason: s.reason,
      status: s.status,
      taskId: s.taskId ?? null,
      error: s.error ?? null,
      costYuan: s.costYuan ?? 0,
      durationMs: s.durationMs,
    })),
    costYuan: row.cost_yuan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function awaitTask(id: string, userId: string): Promise<TaskRow> {
  const deadline = Date.now() + config.TASK_TIMEOUT_MS + 20_000;
  for (;;) {
    const t = findTask(id);
    if (t && (t.status === 'succeeded' || t.status === 'failed' || t.status === 'canceled')) {
      if (t.status === 'failed') throw err((t.error_code as never) ?? 'PROVIDER_FAILED', t.error ?? '任务失败');
      if (t.status === 'canceled') throw err('BAD_REQUEST', '任务已取消');
      return t;
    }
    if (Date.now() > deadline) throw err('PROVIDER_TIMEOUT', '等待任务结果超时');
    await sleep(400);
    void userId;
  }
}

function markDependentsCanceled(steps: StepRecord[], fromIdx: number): void {
  const blocked = new Set<number>([fromIdx]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (s.status === 'pending' && s.deps.some((d) => blocked.has(d))) {
        s.status = 'canceled';
        blocked.add(s.idx);
        changed = true;
      }
    }
  }
}

/**
 * 计划执行器：按拓扑序逐步执行。
 * 服务端步骤 → 提交任务并等结果；前端步骤 → SSE 下发指令并等回执。
 * 任一步失败即停：已完成的步骤保留，下游标 canceled，可单步重试。
 *
 * 同一时刻只允许一个执行器：靠 plans.exec_token 抢占，写库时带着令牌，
 * 令牌没了就立刻停手 —— 否则两个执行器会互相覆盖 steps 并把同一步跑两遍。
 */
export async function executePlan(planId: string, fromIdx = 0): Promise<void> {
  const token = newId('ex');
  if (!claimPlan(planId, token)) {
    log.warn('已有执行器在跑，忽略这次触发', { planId });
    return;
  }
  try {
    await runPlan(planId, fromIdx, token);
  } finally {
    releasePlan(planId, token);
  }
}

async function runPlan(planId: string, fromIdx: number, token: string): Promise<void> {
  const row = findPlan(planId);
  if (!row) return;
  const userId = row.user_id;
  const steps = planSteps(row);
  let totalCost = steps.reduce((a, s) => a + (s.costYuan ?? 0), 0);

  let currentImageId: string | null = null;
  for (const s of steps) if (typeof s.params.imageId === 'string') currentImageId = s.params.imageId;

  /** 带令牌落库并推事件；返回 false 表示执行权已经不在手上，调用方应立即停手 */
  const persist = (patch: { status?: PlanDTO['status']; steps?: StepRecord[]; costYuan?: number }): boolean => {
    const fresh = savePlan(planId, patch, token);
    if (!fresh) {
      log.warn('执行权已丢失，停止写入', { planId });
      return false;
    }
    hub.publish(userId, { type: 'plan.updated', plan: toPlanDTO(fresh) });
    return true;
  };

  if (!persist({ status: 'running', steps, costYuan: totalCost })) return;

  for (let i = fromIdx; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.status === 'succeeded' || step.status === 'skipped') continue;
    const fresh = findPlan(planId);
    if (!fresh || fresh.status === 'canceled' || fresh.exec_token !== token) return;

    const tool = getTool(step.tool);
    if (!tool) {
      step.status = 'failed';
      step.error = `工具 ${step.tool} 已不存在`;
      break;
    }

    const params = { ...step.params };
    const depProduced = step.deps.some((d) => steps[d]?.outputImageId);
    if (tool.needsImage && depProduced && currentImageId) params.imageId = currentImageId;

    step.status = 'running';
    const started = Date.now();
    if (!persist({ steps, costYuan: totalCost })) return;

    try {
      if (tool.executor === 'client') {
        const requestId = newRequestId();
        hub.publish(userId, {
          type: 'agent.client_command',
          planId,
          stepIdx: step.idx,
          tool: step.tool,
          params,
          requestId,
        });
        await waitFor<{ ok: boolean }>(
          requestId,
          config.CLIENT_STEP_TIMEOUT_MS,
          `${tool.title}：浏览器端没有响应（页面可能被切走了），请确认页面还开着`,
        );
      } else {
        const { task } = submitTask({
          userId,
          tool: step.tool,
          params,
          documentId: row.document_id,
          planId,
          stepIdx: step.idx,
        });
        step.taskId = task.id;
        const done = await awaitTask(task.id, userId);
        totalCost += done.cost_yuan;
        step.costYuan = done.cost_yuan;
        if (done.result_image_id) {
          step.outputImageId = done.result_image_id;
          currentImageId = done.result_image_id;
        }
      }
      step.params = params;
      step.status = 'succeeded';
      step.durationMs = Date.now() - started;
    } catch (e) {
      step.status = 'failed';
      step.error = e instanceof Error ? e.message : String(e);
      step.durationMs = Date.now() - started;
      markDependentsCanceled(steps, step.idx);
      totalCost = steps.reduce((a, s) => a + (s.costYuan ?? 0), 0);
      persist({ status: 'failed', steps, costYuan: totalCost });
      return;
    }

    totalCost = steps.reduce((a, s) => a + (s.costYuan ?? 0), 0);
    if (!persist({ steps, costYuan: totalCost })) return;
  }

  const status = steps.some((s) => s.status === 'failed') ? 'failed' : 'done';
  persist({ status, steps, costYuan: totalCost });
}

/** 前端回执入口：requestId 由 agent.client_command 事件下发 */
export function reportClientReceipt(requestId: string, ok: boolean, error?: string): boolean {
  return ok ? settleWait(requestId, { ok: true }) : failWait(requestId, error ?? '浏览器端执行失败');
}
