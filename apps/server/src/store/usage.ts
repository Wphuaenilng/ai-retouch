import { db, run } from '../db/index';
import { today } from '../db/index';

export interface UsageRow {
  user_id: string;
  date: string;
  ai_calls: number;
  cost_yuan: number;
}

export function getUsage(userId: string, date = today()): UsageRow {
  const row = db.prepare('SELECT * FROM usage_daily WHERE user_id = ? AND date = ?').get(userId, date) as
    | UsageRow
    | undefined;
  return row ?? { user_id: userId, date, ai_calls: 0, cost_yuan: 0 };
}

/** 提交时预扣一次调用数 */
export function precountCall(userId: string): UsageRow {
  const date = today();
  run(
    `INSERT INTO usage_daily (user_id, date, ai_calls, cost_yuan) VALUES (?, ?, 1, 0)
     ON CONFLICT(user_id, date) DO UPDATE SET ai_calls = ai_calls + 1`,
    userId,
    date,
  );
  return getUsage(userId, date);
}

/** 执行完成后落实际成本（不再增加次数） */
export function settleCost(userId: string, costYuan: number): UsageRow {
  const date = today();
  run(
    `INSERT INTO usage_daily (user_id, date, ai_calls, cost_yuan) VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET cost_yuan = cost_yuan + excluded.cost_yuan`,
    userId,
    date,
    costYuan,
  );
  return getUsage(userId, date);
}

/** 最终失败或取消时退还那次预扣 */
export function refundCall(userId: string): void {
  run('UPDATE usage_daily SET ai_calls = MAX(ai_calls - 1, 0) WHERE user_id = ? AND date = ?', userId, today());
}

/** 全局日熔断用 */
export function globalCostToday(): number {
  const row = db.prepare('SELECT COALESCE(SUM(cost_yuan), 0) AS c FROM usage_daily WHERE date = ?').get(today()) as {
    c: number | bigint;
  };
  return Number(row.c);
}
