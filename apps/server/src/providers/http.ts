import { UpstreamError } from './types';

const DEFAULT_TIMEOUT = 90_000;

async function call<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
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

export const postJson = <T>(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = DEFAULT_TIMEOUT) =>
  call<T>(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, timeoutMs);

export const getJson = <T>(url: string, headers: Record<string, string> = {}, timeoutMs = DEFAULT_TIMEOUT) =>
  call<T>(url, { method: 'GET', headers }, timeoutMs);

export async function fetchBinary(url: string, timeoutMs = DEFAULT_TIMEOUT): Promise<{ base64: string; mime: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new UpstreamError('network', `下载上游结果失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new UpstreamError('http', `下载上游结果返回 ${res.status}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: `data:${res.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}`, mime: res.headers.get('content-type') ?? 'image/png' };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到成功/失败/超时，间隔指数退避 */
export async function poll<T>(
  fn: () => Promise<{ done: boolean; value?: T; failed?: string }>,
  { intervalMs = 1500, timeoutMs = 120_000, onProgress }: { intervalMs?: number; timeoutMs?: number; onProgress?: (elapsed: number) => void },
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const r = await fn();
    if (r.done) {
      if (r.failed) throw new UpstreamError('bad_response', r.failed);
      return r.value as T;
    }
    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) throw new UpstreamError('timeout', '上游任务超时');
    onProgress?.(Math.min(0.9, elapsed / timeoutMs));
    await sleep(Math.min(intervalMs * (1 + elapsed / 20_000), 6000));
  }
}
