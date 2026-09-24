import type { PlanDTO } from '@retouch/shared';
import { err } from '../lib/errors';
import { hub } from '../lib/sse';
import { plan } from '../agent/planner';
import { validatePlan } from '../agent/validator';
import { executePlan, reportClientReceipt, toPlanDTO } from '../agent/executor';
import { insertPlan, listPlans, planSteps, savePlan, type StepRecord, findPlan } from '../store/plans';
import { docFacts, requireDoc } from './documents';

export { reportClientReceipt };

/** 自然语言 → 校验过的可执行计划（状态 proposed，等用户确认） */
export async function createPlan(input: { userId: string; documentId: string; message: string }): Promise<PlanDTO> {
  const doc = requireDoc(input.documentId, input.userId);
  const facts = docFacts(doc);
  const message = input.message.trim();
  if (!message) throw err('BAD_REQUEST', '先说说你想怎么改');

  const first = await plan({ message, facts });
  let result = validatePlan(first.draft, facts);

  // 校验失败时，把原因回喂给模型再试一次（规则式规划器没有可修正的空间，直接报错）
  if (!result.ok && first.planner.startsWith('llm')) {
    const retry = await plan({ message, facts, feedback: result.errors });
    result = validatePlan(retry.draft, facts);
  }
  if (!result.ok) throw err('PLAN_EMPTY', result.errors.join('；'), result.errors);

  const steps: StepRecord[] = result.steps.map((s) => ({ ...s, status: 'pending', taskId: null, error: null }));
  const row = insertPlan({
    userId: input.userId,
    documentId: input.documentId,
    userMessage: message,
    planner: first.planner,
    summary: first.draft.summary ?? `拆成 ${steps.length} 步执行`,
    steps,
  });
  const dto = toPlanDTO(row);
  hub.publish(input.userId, { type: 'plan.created', plan: dto });
  return dto;
}

function requirePlan(id: string, userId: string) {
  const row = findPlan(id);
  if (!row || row.user_id !== userId) throw err('NOT_FOUND', `计划 ${id} 不存在`);
  return row;
}

export function approvePlan(id: string, userId: string): PlanDTO {
  const row = requirePlan(id, userId);
  if (row.status !== 'proposed') throw err('PLAN_NOT_APPROVABLE', '这个计划已经不在待确认状态了');
  savePlan(id, { status: 'approved' });
  // 不 await：HTTP 先返回，进度靠 SSE
  void executePlan(id).catch((e) => console.error('[agent] 计划执行异常', e));
  return toPlanDTO(findPlan(id)!);
}

/** 单步重试：从该步开始重跑，已成功的步骤不动 */
export function retryStep(planId: string, idx: number, userId: string): PlanDTO {
  const row = requirePlan(planId, userId);
  const steps = planSteps(row);
  const step = steps.find((s) => s.idx === idx);
  if (!step) throw err('NOT_FOUND', `计划里没有第 ${idx + 1} 步`);
  if (step.status !== 'failed' && step.status !== 'canceled') throw err('BAD_REQUEST', '只有失败或被取消的步骤能重试');

  for (const s of steps) {
    if (s.idx === idx || s.status === 'canceled') {
      s.status = 'pending';
      s.error = null;
      s.taskId = null;
    }
  }
  savePlan(planId, { status: 'approved', steps });
  void executePlan(planId, idx).catch((e) => console.error('[agent] 重试异常', e));
  return toPlanDTO(findPlan(planId)!);
}

/** 跳过该步并继续下游 */
export function skipStep(planId: string, idx: number, userId: string): PlanDTO {
  const row = requirePlan(planId, userId);
  const steps = planSteps(row);
  const step = steps.find((s) => s.idx === idx);
  if (!step) throw err('NOT_FOUND', `计划里没有第 ${idx + 1} 步`);
  step.status = 'skipped';
  step.error = null;
  for (const s of steps) if (s.status === 'canceled') s.status = 'pending';
  savePlan(planId, { status: 'approved', steps });
  void executePlan(planId, idx + 1).catch((e) => console.error('[agent] 跳过后继续异常', e));
  return toPlanDTO(findPlan(planId)!);
}

export function cancelPlan(id: string, userId: string): PlanDTO {
  const row = requirePlan(id, userId);
  if (row.status === 'done' || row.status === 'failed') throw err('BAD_REQUEST', '计划已结束，无法取消');
  const steps = planSteps(row).map((s) => (s.status === 'pending' || s.status === 'running' ? { ...s, status: 'canceled' as const } : s));
  savePlan(id, { status: 'canceled', steps });
  const dto = toPlanDTO(findPlan(id)!);
  hub.publish(userId, { type: 'plan.updated', plan: dto });
  return dto;
}

export function listUserPlans(userId: string): PlanDTO[] {
  return listPlans(userId).map(toPlanDTO);
}
