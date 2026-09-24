import { UpstreamError } from './types';

const DEFAULT_TIMEOUT = 90_000;

/** 任务自己的超时/退出信号与单次请求超时并存：任一触发都要真的把 fetch 掐掉 */
function signalFor(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, t]) : t;
}

const aborted = (s?: AbortSignal): boolean => s?.aborted === true;

async function call<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: signalFor(signal, timeoutMs) });
  } catch (e) {
    if (aborted(signal)) throw new UpstreamError('timeout', '上游请求已取消（任务超时或服务退出）');
    const msg = e instanceof Error ? e.message : String(e);
    throw new UpstreamError(/timeout|abort/i.test(msg) ? 'timeout' : 'network', `上游连接失败：${msg}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 有些网关错误返回 HTML */
  }
  if (!res.ok) {
    throw new UpstreamError('http', `上游返回 ${res.status}`, res.status, json ?? text.slice(0, 400));
  }
  if (!json) throw new UpstreamError('bad_response', '上游返回空响应体');
  return json as T;
}

export const postJson = <T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
) =>
  call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, timeoutMs, signal);

export const getJson = <T>(url: string, headers: Record<string, string> = {}, timeoutMs = DEFAULT_TIMEOUT, signal?: AbortSignal) =>
  call<T>(url, { method: 'GET', headers }, timeoutMs, signal);

/** 上游结果图的硬上限：没有它，一个乱给的 URL 就能把整个进程 OOM 掉 */
const MAX_RESULT_BYTES = 48 * 1024 * 1024;

export async function fetchBinary(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
  maxBytes = MAX_RESULT_BYTES,
): Promise<{ base64: string; mime: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: signalFor(signal, timeoutMs) });
  } catch (e) {
    if (aborted(signal)) throw new UpstreamError('timeout', '结果下载已取消（任务超时或服务退出）');
    throw new UpstreamError('network', `下载上游结果失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new UpstreamError('http', `下载上游结果返回 ${res.status}`, res.status);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new UpstreamError('bad_response', `上游结果过大：${Math.round(declared / 1048576)}MB > ${Math.round(maxBytes / 1048576)}MB`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new UpstreamError('bad_response', `上游结果过大：${Math.round(buf.length / 1048576)}MB > ${Math.round(maxBytes / 1048576)}MB`);
  }
  const mime = res.headers.get('content-type') ?? 'image/png';
  return { base64: `data:${mime};base64,${buf.toString('base64')}`, mime };
}

/** 可被取消的等待：signal 触发时立刻返回，让调用方的 aborted 检查马上生效 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 轮询直到成功/失败/超时/被取消，间隔指数退避 */
export async function poll<T>(
  fn: () => Promise<{ done: boolean; value?: T; failed?: string }>,
  {
    intervalMs = 1500,
    timeoutMs = 120_000,
    onProgress,
    signal,
  }: { intervalMs?: number; timeoutMs?: number; onProgress?: (elapsed: number) => void; signal?: AbortSignal },
): Promise<T> {
  const start = Date.now();
  for (;;) {
    if (aborted(signal)) throw new UpstreamError('timeout', '轮询已取消（任务超时或服务退出）');
    const r = await fn();
    if (r.done) {
      if (r.failed) throw new UpstreamError('bad_response', r.failed);
      return r.value as T;
    }
    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) throw new UpstreamError('timeout', '上游任务超时');
    onProgress?.(Math.min(0.9, elapsed / timeoutMs));
    await sleep(Math.min(intervalMs * (1 + elapsed / 20_000), 6000), signal);
  }
}
