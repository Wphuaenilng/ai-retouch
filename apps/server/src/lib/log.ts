import type { FastifyBaseLogger } from 'fastify';

/**
 * 服务层（worker 回收、provider 降级、计划执行、审核故障）不在任何 req 上下文里，
 * 偏偏又是最需要留痕的地方。直接 `console.*` 会绕过 Fastify 的 logger：
 * 级别开关失效、不是结构化 JSON、容器里也采不到。所以这里挂一个根 logger 句柄，
 * buildApp() 之后注入一次；没注入时退回 console，好让测试与 CLI 脚本照样能看到东西。
 */
let base: FastifyBaseLogger | undefined;

export function setRootLogger(logger: FastifyBaseLogger): void {
  base = logger;
}

type Line = (msg: string, fields?: Record<string, unknown>) => void;

function out(level: 'info' | 'warn' | 'error'): Line {
  return (msg, fields) => {
    if (!base) {
      // pino 的参数顺序是 (obj, msg)：反着传会把消息打成 [object Object]
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](msg, fields ?? '');
      return;
    }
    base[level]({ ...(fields ?? {}) }, msg);
  };
}

export const log = {
  info: out('info'),
  warn: out('warn'),
  error: out('error'),
};

/** 生成给用户看得到的短编号：截图里能报出来，日志里能搜到 */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
