/**
 * 每日成本与故障报表：`pnpm --filter @retouch/server cost-report [--date=YYYY-MM-DD]`
 *
 * 为什么要脚本而不是看板：这是自部署，没有地方长期开着管理页；真正会出事的是
 * "某天上游按错了价 / 有人在批量跑图"，而那是靠 cron 的退出码通知人的。
 * 退出码：0 正常 · 2 成本达到预算 80% 以上 · 3 当天失败率超过一半
 * 所以 cron 里 `|| notify` 就够了：`0 8 * * * cd /srv/retouch && pnpm --filter @retouch/server cost-report >> /var/log/retouch-cost.log 2>&1 || 你的通知命令`
 *
 * 日期口径注意：`usage_daily.date` 用的是**服务器本地日**（`db/index.ts:today()`），
 * 容器默认 UTC，国内就是早上 8 点切一天 —— 这份报表跟着同一个口径。
 */
import { config } from '../src/config';
import { closeDb, db, today } from '../src/db/index';

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const date = arg('date') ?? today();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date 要是 YYYY-MM-DD，收到 ${date}`);
  closeDb();
  process.exit(1);
}

const num = (v: unknown): number => Number(typeof v === 'bigint' ? Number(v) : v);

const totals = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM usage_daily WHERE date = :d)                            AS users,
       COALESCE((SELECT SUM(ai_calls) FROM usage_daily WHERE date = :d), 0)          AS calls,
       COALESCE((SELECT SUM(cost_yuan) FROM usage_daily WHERE date = :d), 0)         AS cost,
       COALESCE((SELECT COUNT(*) FROM tasks WHERE substr(created_at, 1, 10) = :d), 0) AS tasks,
       COALESCE((SELECT COUNT(*) FROM tasks WHERE substr(created_at, 1, 10) = :d AND status = 'succeeded'), 0) AS okTasks,
       COALESCE((SELECT COUNT(*) FROM tasks WHERE substr(created_at, 1, 10) = :d AND status = 'failed'), 0)    AS badTasks,
       COALESCE((SELECT COUNT(*) FROM tasks WHERE substr(created_at, 1, 10) = :d AND charged = 0), 0)          AS unsettled,
       COALESCE((SELECT COUNT(*) FROM tasks WHERE substr(created_at, 1, 10) = :d AND charged = 2), 0)          AS refunded`,
  )
  .get({ d: date }) as Record<string, unknown>;

const cost = num(totals.cost);
const budget = config.DAILY_BUDGET_YUAN;

console.log(`\n=== retouch-studio 日报 ${date} ===`);
console.log(
  `任务 ${num(totals.tasks)}（成功 ${num(totals.okTasks)} / 失败 ${num(totals.badTasks)}）` +
    `· 计费调用 ${num(totals.calls)} 次 · 成本 ¥${cost.toFixed(4)} / 预算 ¥${budget}（${budget > 0 ? ((cost / budget) * 100).toFixed(1) : '—'}%）`,
);
console.log(`账目：未结算 charged=0 有 ${num(totals.unsettled)} 条，已退还 charged=2 有 ${num(totals.refunded)} 条`);

const perUser = db
  .prepare(
    `SELECT u.username, d.ai_calls, d.cost_yuan
       FROM usage_daily d JOIN users u ON u.id = d.user_id
      WHERE d.date = :d ORDER BY d.cost_yuan DESC LIMIT 10`,
  )
  .all({ d: date }) as { username: string; ai_calls: number | bigint; cost_yuan: number }[];
if (perUser.length) {
  console.log('\n花费前列：');
  for (const r of perUser)
    console.log(`  ${r.username.padEnd(24)} ${String(Number(r.ai_calls)).padStart(4)} 次  ¥${r.cost_yuan.toFixed(4)}`);
}

const byTool = db
  .prepare(
    `SELECT tool, status, COUNT(*) n, COALESCE(SUM(cost_yuan), 0) c
       FROM tasks WHERE substr(created_at, 1, 10) = :d GROUP BY tool, status ORDER BY tool`,
  )
  .all({ d: date }) as { tool: string; status: string; n: number | bigint; c: number }[];
if (byTool.length) {
  console.log('\n按工具：');
  for (const r of byTool)
    console.log(`  ${r.tool.padEnd(22)} ${r.status.padEnd(10)} ${String(Number(r.n)).padStart(4)}  ¥${r.c.toFixed(4)}`);
}

const errors = db
  .prepare(
    `SELECT COALESCE(error_code, 'UNKNOWN') code, COUNT(*) n
       FROM tasks WHERE substr(created_at, 1, 10) = :d AND status = 'failed' GROUP BY code ORDER BY n DESC LIMIT 6`,
  )
  .all({ d: date }) as { code: string; n: number | bigint }[];
if (errors.length) {
  console.log('\n失败原因：');
  for (const r of errors) console.log(`  ${r.code.padEnd(24)} ${Number(r.n)}`);
}

closeDb();

// 退出码是给 cron 用的，别把结论埋在输出里
const badRate = num(totals.tasks) > 0 ? num(totals.badTasks) / num(totals.tasks) : 0;
if (badRate > 0.5) {
  console.error(`失败率 ${(badRate * 100).toFixed(0)}% —— 先查上游和配额`);
  process.exit(3);
}
if (budget > 0 && cost >= budget * 0.8) {
  console.error(`成本已达预算 80%（¥${cost.toFixed(2)} / ¥${budget}）`);
  process.exit(2);
}
process.exit(0);
