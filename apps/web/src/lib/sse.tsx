import { useEffect, useRef, type ReactElement } from 'react';
import type { ServerEvent } from '@retouch/shared';

type Handler = (e: ServerEvent) => void | Promise<void>;
const listeners = new Set<Handler>();
const opens = new Set<() => void>();

export function onServerEvent(h: Handler): () => void {
  listeners.add(h);
  return () => listeners.delete(h);
}

/** 连接建立或断线重连时回调；用来主动拉一次进行中任务，兜住 SSE 之外错过的终态 */
export function onSseOpen(cb: () => void): () => void {
  opens.add(cb);
  return () => opens.delete(cb);
}

/** 订阅某一类服务端事件；handler 用 ref 持有，调用方不必管依赖数组 */
export function useEvent<T extends ServerEvent['type']>(type: T, cb: (e: Extract<ServerEvent, { type: T }>) => void | Promise<void>): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onServerEvent((e) => void (e.type === type && (ref.current as unknown as (x: ServerEvent) => void)(e))), [type]);
}

/**
 * 一条全局 SSE。EventSource 自带重连并回带 Last-Event-ID，
 * 服务端有环形缓冲可重放，所以断线期间的任务结果不会丢。
 */
export function SseBridge({ enabled }: { enabled: boolean }): ReactElement | null {
  useEffect(() => {
    if (!enabled) return undefined;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => {
      for (const f of [...opens]) f();
    };
    es.onmessage = (m) => {
      let e: ServerEvent | null = null;
      try {
        e = JSON.parse(m.data) as ServerEvent;
      } catch {
        return;
      }
      // 一个订阅者抛错不该让其余面板从此收不到事件
      for (const h of [...listeners]) void (async () => h(e))().catch((err) => console.error('[sse] 事件处理失败', err));
    };
    return () => es.close();
  }, [enabled]);
  return null;
}
