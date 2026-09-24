import { useEffect, useRef, type ReactElement } from 'react';
import type { ServerEvent } from '@retouch/shared';

type Handler = (e: ServerEvent) => void | Promise<void>;
const listeners = new Set<Handler>();

export function onServerEvent(h: Handler): () => void {
  listeners.add(h);
  return () => listeners.delete(h);
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
    es.onmessage = (m) => {
      let e: ServerEvent | null = null;
      try {
        e = JSON.parse(m.data) as ServerEvent;
      } catch {
        return;
      }
      for (const h of [...listeners]) h(e as ServerEvent);
    };
    return () => es.close();
  }, [enabled]);
  return null;
}
