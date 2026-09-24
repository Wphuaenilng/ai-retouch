import type { TaskStatus } from '@retouch/shared';
import { all, db, nowIso, run } from '../db/index';
import { newTaskId } from '../lib/ids';

export interface TaskRow {
  id: string;
  user_id: string;
  document_id: string | null;
  plan_id: string | null;
  step_idx: number | null;
  tool: string;
  status: TaskStatus;
  progress: number;
  provider: string | null;
  model: string | null;
  input: string;
  mask_image_id: string | null;
  image_id: string | null;
  result_image_id: string | null;
  output: string | null;
  cost_yuan: number;
  error: string | null;
  error_code: string | null;
  attempts: number;
  charged: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function insertTask(input: {
  userId: string;
  tool: string;
  params: Record<string, unknown>;
  documentId?: string | null;
  planId?: string | null;
  stepIdx?: number | null;
  imageId?: string | null;
  maskImageId?: string | null;
}): TaskRow {
  const id = newTaskId();
  run(
    `INSERT INTO tasks (id, user_id, document_id, plan_id, step_idx, tool, status, progress, input, image_id, mask_image_id, cost_yuan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, 0, ?)`,
    id,
    input.userId,
    input.documentId ?? null,
    input.planId ?? null,
    input.stepIdx ?? null,
    input.tool,
    JSON.stringify(input.params),
    input.imageId ?? null,
    input.maskImageId ?? null,
    nowIso(),
  );
  return findTask(id)!;
}

export function findTask(id: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
}

export function listTasks(userId: string, opts: { status?: TaskStatus[]; limit?: number; before?: string } = {}): TaskRow[] {
  const limit = Math.min(opts.limit ?? 40, 200);
  const where = ['user_id = ?'];
  const args: unknown[] = [userId];
  if (opts.before) {
    where.push('created_at < ?');
    args.push(opts.before);
  }
  if (opts.status?.length) {
    where.push(`status IN (${opts.status.map(() => '?').join(',')})`);
    args.push(...opts.status);
  }
  args.push(limit);
  return all<TaskRow>(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...args);
}

/** 原子领取一个排队任务；RETURNING 让我们一次拿到最新行 */
export function claimNextTask(): TaskRow | undefined {
  return db
    .prepare(
      `UPDATE tasks SET status = 'running', started_at = ?, attempts = attempts + 1
       WHERE id = (SELECT id FROM tasks WHERE status = 'queued' ORDER BY created_at LIMIT 1)
       RETURNING *`,
    )
    .get(nowIso()) as TaskRow | undefined;
}

export function setProgress(id: string, progress: number): void {
  run('UPDATE tasks SET progress = ? WHERE id = ?', Math.max(0, Math.min(1, progress)), id);
}

export function setProvider(id: string, provider: string, model: string): void {
  run('UPDATE tasks SET provider = ?, model = ? WHERE id = ?', provider, model, id);
}

export function markSucceeded(id: string, resultImageId: string | null, costYuan: number, output?: unknown): void {
  run(
    `UPDATE tasks SET status = 'succeeded', progress = 1, result_image_id = ?, cost_yuan = ?, charged = 1,
     output = ?, finished_at = ? WHERE id = ?`,
    resultImageId,
    costYuan,
    output ? JSON.stringify(output) : null,
    nowIso(),
    id,
  );
}

export function markFailed(id: string, code: string, message: string, opts: { requeue?: boolean } = {}): void {
  run(
    'UPDATE tasks SET status = ?, error = ?, error_code = ?, finished_at = ? WHERE id = ?',
    opts.requeue ? 'queued' : 'failed',
    message.slice(0, 400),
    code,
    opts.requeue ? null : nowIso(),
    id,
  );
}

export function cancelQueued(id: string, userId: string): boolean {
  return (
    run(
      "UPDATE tasks SET status = 'canceled', finished_at = ? WHERE id = ? AND user_id = ? AND status = 'queued'",
      nowIso(),
      id,
      userId,
    ).changes === 1
  );
}

/** 重试：只有失败任务能重新排队 */
export function requeue(id: string, userId: string): boolean {
  return (
    run(
      // 手动重试会再预扣一次，所以 charged 必须回到"未结算"，否则那次预扣永远退不回来
      "UPDATE tasks SET status = 'queued', progress = 0, error = NULL, error_code = NULL, finished_at = NULL, charged = 0 WHERE id = ? AND user_id = ? AND status = 'failed'",
      id,
      userId,
    ).changes === 1
  );
}

/**
 * 把某次预扣标记为"已退还"。charged 0→2 只会成功一次，
 * 所以它就是退款幂等锁（1 表示已结算真实成本）。
 */
export function markRefunded(id: string): boolean {
  return run('UPDATE tasks SET charged = 2 WHERE id = ? AND charged = 0', id).changes === 1;
}

/**
 * 进程重启后清理：上次没跑完的 running 任务判失败，避免永远卡在进度条。
 * 顺带把"预扣了但没结算"的行标成已退，并返回该退谁的账 —— 以前这些配额就这么漏掉了。
 */
export function reapStaleRunning(): { count: number; refundUserIds: string[] } {
  const refundUserIds = all<{ user_id: string }>("SELECT user_id FROM tasks WHERE status = 'running' AND charged = 0").map(
    (r) => r.user_id,
  );
  const r = run(
    "UPDATE tasks SET status = 'failed', error = '服务重启导致中断，配额已退回，请重试', error_code = 'INTERNAL', finished_at = ?, charged = CASE WHEN charged = 0 THEN 2 ELSE charged END WHERE status = 'running'",
    nowIso(),
  );
  return { count: r.changes, refundUserIds };
}

export function taskParams(row: TaskRow): Record<string, unknown> {
  return JSON.parse(row.input) as Record<string, unknown>;
}
