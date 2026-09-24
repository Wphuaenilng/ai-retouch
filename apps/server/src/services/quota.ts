import type { QuotaDTO } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { findUser } from '../store/users';
import { getUsage, globalCostToday, precountCall, refundCall, settleCost } from '../store/usage';

export function getQuota(userId: string): QuotaDTO {
  const user = findUser(userId);
  const limit = user?.quota_per_day ?? config.PER_USER_DAILY_CALLS;
  const usage = getUsage(userId);
  return {
    limit,
    used: usage.ai_calls,
    remaining: Math.max(0, limit - usage.ai_calls),
    costTodayYuan: Math.round(usage.cost_yuan * 10000) / 10000,
  };
}

/** 提交前检查：个人日配额 + 全局日预算熔断 */
export function assertCanSubmit(userId: string): void {
  const q = getQuota(userId);
  if (q.remaining <= 0) {
    throw err('QUOTA_EXCEEDED', `今日 ${q.limit} 次 AI 调用已用完，明天 0 点重置`);
  }
  if (globalCostToday() >= config.DAILY_BUDGET_YUAN) {
    throw err('QUOTA_EXCEEDED', '今日全站成本已触发熔断，请联系管理员调整 DAILY_BUDGET_YUAN');
  }
}

export const precount = precountCall;
export const settle = settleCost;
export const refund = refundCall;
