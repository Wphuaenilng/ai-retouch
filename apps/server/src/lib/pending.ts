import { err } from '../lib/errors';

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const store = new Map<string, Pending<unknown>>();

/**
 * 等待外部回执（前端画布执行客户端工具的结果）。
 * 服务端下发指令 → 挂起 → 前端 POST 回执 → 唤醒。
 */
export function waitFor<T>(key: string, timeoutMs: number, onTimeoutMessage?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      store.delete(key);
      reject(err('CLIENT_TIMEOUT', onTimeoutMessage ?? '浏览器端未在限定时间内完成，请检查页面是否还开着'));
    }, timeoutMs);
    timer.unref?.();
    store.set(key, { resolve: resolve as (v: unknown) => void, reject, timer });
  });
}

export function settleWait<T>(key: string, value: T): boolean {
  const p = store.get(key);
  if (!p) return false;
  clearTimeout(p.timer);
  store.delete(key);
  p.resolve(value);
  return true;
}

export function failWait(key: string, message: string): boolean {
  const p = store.get(key);
  if (!p) return false;
  clearTimeout(p.timer);
  store.delete(key);
  p.reject(new Error(message));
  return true;
}

export function pendingCount(): number {
  return store.size;
}
