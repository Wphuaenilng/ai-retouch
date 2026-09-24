/** 把"下一次日切"讲成人话：只说还要等多久，不假设用户和服务器在一个时区 */
export function untilText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '刚刚';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小时后`;
  if (h > 0) return `${h} 小时 ${m} 分后`;
  return `${m} 分后`;
}
