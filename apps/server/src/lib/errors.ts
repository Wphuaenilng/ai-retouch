import type { ErrorCode } from '@retouch/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVITE_INVALID: 400,
  USERNAME_TAKEN: 409,
  BAD_CREDENTIALS: 401,
  QUOTA_EXCEEDED: 429,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_UNSUPPORTED: 415,
  MODERATION_REJECTED: 422,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_FAILED: 502,
  PROVIDER_TIMEOUT: 504,
  TOOL_UNKNOWN: 400,
  TOOL_PARAMS_INVALID: 400,
  PLAN_CYCLE: 400,
  PLAN_EMPTY: 400,
  PLAN_NOT_APPROVABLE: 409,
  NEEDS_IMAGE: 400,
  NEEDS_MASK: 400,
  CLIENT_TIMEOUT: 504,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code] ?? 400;
  }
}

export const err = (code: ErrorCode, message: string, details?: unknown) => new AppError(code, message, details);

/** 把任意异常规整成稳定错误码，前端只认 code，不解析文案 */
export function normalizeError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout/i.test(msg)) return err('PROVIDER_TIMEOUT', '模型响应超时，可稍后重试');
  if (/quota|rate.?limit/i.test(msg)) return err('QUOTA_EXCEEDED', '上游限流，请稍后再试');
  console.error('[unexpected error]', e);
  return err('INTERNAL', '服务器内部错误，请把任务号发给管理员');
}
