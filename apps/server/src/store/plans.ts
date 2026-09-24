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
  created_at: string;
  updated_at: string;
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
  run(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return findPlan(id);
}

export function planSteps(row: PlanRow): StepRecord[] {
  return JSON.parse(row.steps) as StepRecord[];
}
