import { err } from './errors';

/**
 * 查询/请求参数的窄化入口。
 * 这里统一负责把外部输入变成可信值：非法输入必须是 400，
 * 不能让 NaN 流进 SQL（会变成 500 + INTERNAL 日志），也不能悄悄当默认值吞掉。
 */
export function intParam(value: string | undefined, opts: { name: string; default: number; min?: number; max: number }): number {
  if (value === undefined || value === '') return opts.default;
  const n = Number(value);
  const min = opts.min ?? 1;
  if (!Number.isInteger(n) || n < min || n > opts.max) {
    throw err('BAD_REQUEST', `参数 ${opts.name} 需要是 ${min} 到 ${opts.max} 之间的整数`);
  }
  return n;
}

/**
 * JSON body 里的整数字段。以前各处写的是 `Math.min(Math.max(Number(x) || 1, 1), 20)`，
 * 那是把 "abc" 静默变成 1、把 0 变成 1、把 999 变成 20 —— 用户以为设了别的值。
 */
export function intField(value: unknown, opts: { name: string; default: number; min: number; max: number }): number {
  if (value === undefined || value === null || value === '') return opts.default;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < opts.min || n > opts.max) {
    throw err('BAD_REQUEST', `${opts.name} 需要是 ${opts.min} 到 ${opts.max} 之间的整数`);
  }
  return n;
}

/** 字符串字段：类型不对就当没给，别把 number 之类的脏值带进 slice/模板串 */
export function strParam(value: unknown, opts: { name: string; max: number }): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw err('BAD_REQUEST', `参数 ${opts.name} 需要是字符串`);
  if (value.length > opts.max) throw err('BAD_REQUEST', `参数 ${opts.name} 最长 ${opts.max} 字`);
  return value;
}

/** decodeURIComponent 对畸形百分号会抛 URIError：URL 与 Cookie 都来自外部，不能让它冒成 500 */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
