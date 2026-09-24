import type { ApiError as ApiErrorShape } from '@retouch/shared';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const hasBody = init.body !== undefined && init.body !== null;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      // 没有 body 时不能带 content-type: application/json，否则 Fastify 直接 400/500
      ...(hasBody && !isForm ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  type Envelope = { ok: boolean; data?: T; error?: ApiErrorShape };
  let json: Envelope | null = null;
  try {
    json = text ? (JSON.parse(text) as Envelope) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.ok === false) {
    if (res.status === 401) window.dispatchEvent(new Event('retouch:unauthorized'));
    throw new ApiError(json?.error?.code ?? 'INTERNAL', json?.error?.message ?? `${res.status} ${res.statusText}`, res.status, json?.error?.details);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  form: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

/** 错误码 → 人话。前端只认 code，不解析 message 文本 */
export const ERROR_HINTS: Record<string, string> = {
  UNAUTHORIZED: '登录状态已过期，请重新登录',
  QUOTA_EXCEEDED: '今日次数已用完，明天 0 点重置',
  MODERATION_REJECTED: '内容未通过安全审核',
  MODERATION_UNAVAILABLE: '审核服务暂时不可用，稍后重试（为避免漏审，成品图不放行）',
  PROVIDER_TIMEOUT: '模型响应超时，点重试即可',
  PROVIDER_UNAVAILABLE: '模型未就绪，请联系管理员检查配置',
  PROVIDER_FAILED: '模型调用失败，可稍后重试',
  NEEDS_MASK: '先在画布上涂抹要处理的区域',
  NEEDS_IMAGE: '先上传一张图',
  CLIENT_TIMEOUT: '浏览器端没响应，页面可能被切走了',
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return ERROR_HINTS[e.code] ?? e.message;
  return e instanceof Error ? e.message : String(e);
}
