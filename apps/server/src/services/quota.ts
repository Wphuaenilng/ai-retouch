import type { QuotaDTO } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { findUser } from '../store/users';
import { getUsage, globalCostToday, precountCall, refundCall, settleCost } from '../store/usage';

/**
 * 下一次日切时间。配额是按**服务器本地日**算的（`db/index.ts:today()`），
 * 所以"明天 0 点"这句话只有在用户和服务器同一时区时才成立 —— 容器跑 UTC、
 * 人在国内，实际是早上 8 点重置。与其在文案里解释时区，不如直接把时刻给出去。
 */
export function nextReset(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return next.toISOString();
}

export function getQuota(userId: string): QuotaDTO {
  const user = findUser(userId);
  const limit = user?.quota_per_day ?? config.PER_USER_DAILY_CALLS;
  const usage = getUsage(userId);
  return {
    limit,
    used: usage.ai_calls,
    remaining: Math.max(0, limit - usage.ai_calls),
    costTodayYuan: Math.round(usage.cost_yuan * 10000) / 10000,
    resetsAt: nextReset(),
  };
}

/** 提交前检查：个人日配额 + 全局日预算熔断 */
export function assertCanSubmit(userId: string): void {
  const q = getQuota(userId);
  if (q.remaining <= 0) {
    const at = new Date(q.resetsAt);
    const hh = String(at.getHours()).padStart(2, '0');
    const mm = String(at.getMinutes()).padStart(2, '0');
    throw err('QUOTA_EXCEEDED', `今日 ${q.limit} 次 AI 调用已用完，${hh}:${mm}（服务器时间）重置`);
  }
  if (globalCostToday() >= config.DAILY_BUDGET_YUAN) {
    throw err('QUOTA_EXCEEDED', '今日全站成本已触发熔断，请联系管理员调整 DAILY_BUDGET_YUAN');
  }
}

export const precount = precountCall;
export const settle = settleCost;
export const refund = refundCall;
