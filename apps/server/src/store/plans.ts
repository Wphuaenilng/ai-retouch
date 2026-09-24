import type { PlanStatus, ValidatedStep } from '@retouch/shared';
import { all, db, nowIso, run } from '../db/index';
import { newPlanId } from '../lib/ids';

export interface StepRecord extends ValidatedStep {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled';
  taskId?: string | null;
  error?: string | null;
  costYuan?: number;
  durationMs?: number;
  /** 这步产出的新图，下游步骤会改用它作为输入 */
  outputImageId?: string | null;
}

export interface PlanRow {
  id: string;
  user_id: string;
  document_id: string;
  user_message: string;
  planner: string;
  status: PlanStatus;
  summary: string | null;
  steps: string;
  cost_yuan: number;
  exec_token: string | null;
  exec_started_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 抢占执行权：只有把 exec_token 从"没人持有"翻成自己的人才算拿到锁。
 * 以前 approve / retry / skip 都能各自起一个 executePlan，两个执行器对同一份
 * steps JSON 读-改-写，互相覆盖状态、还会把同一步跑两遍重复扣钱。
 */
export function claimPlan(id: string, token: string): boolean {
  return run('UPDATE plans SET exec_token = ?, exec_started_at = ? WHERE id = ? AND exec_token IS NULL', token, nowIso(), id).changes === 1;
}

export function releasePlan(id: string, token: string): void {
  run('UPDATE plans SET exec_token = NULL, exec_started_at = NULL WHERE id = ? AND exec_token = ?', id, token);
}

/** 进程重启：上次死掉时留下的锁全部放开（否则那个计划永远没法再执行） */
export function resetPlanLocks(): number {
  return run('UPDATE plans SET exec_token = NULL, exec_started_at = NULL WHERE exec_token IS NOT NULL').changes;
}

export function insertPlan(input: {
  userId: string;
  documentId: string;
  userMessage: string;
  planner: string;
  summary?: string;
  steps: StepRecord[];
}): PlanRow {
  const id = newPlanId();
  const now = nowIso();
  run(
    `INSERT INTO plans (id, user_id, document_id, user_message, planner, status, summary, steps, cost_yuan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, 0, ?, ?)`,
    id,
    input.userId,
    input.documentId,
    input.userMessage.slice(0, 1000),
    input.planner,
    input.summary ?? null,
    JSON.stringify(input.steps),
    now,
    now,
  );
  return findPlan(id)!;
}

export function findPlan(id: string): PlanRow | undefined {
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
}

export function listPlans(userId: string, limit = 30): PlanRow[] {
  return all<PlanRow>('SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, Math.min(limit, 100));
}

export function savePlan(
  id: string,
  patch: { status?: PlanStatus; steps?: StepRecord[]; costYuan?: number },
  token?: string,
): PlanRow | undefined {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (patch.steps) {
    sets.push('steps = ?');
    args.push(JSON.stringify(patch.steps));
  }
  if (patch.costYuan !== undefined) {
    sets.push('cost_yuan = ?');
    args.push(patch.costYuan);
  }
  if (!sets.length) return findPlan(id);
  sets.push('updated_at = ?');
  args.push(nowIso(), id);
  let where = 'WHERE id = ?';
  if (token) {
    // 带着令牌写：锁已经不归自己就一个字都不改，避免把别人的执行结果盖掉
    where += ' AND exec_token = ?';
    args.push(token);
  }
  if (run(`UPDATE plans SET ${sets.join(', ')} ${where}`, ...args).changes === 0) return undefined;
  return findPlan(id);
}

export function planSteps(row: PlanRow): StepRecord[] {
  return JSON.parse(row.steps) as StepRecord[];
}
