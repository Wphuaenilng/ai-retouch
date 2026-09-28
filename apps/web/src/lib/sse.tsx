import { useEffect, type ReactElement } from 'react';
import type { ServerEvent } from '@retouch/shared';
import { emitServerEvent, emitSseOpen } from './sse-bus';

/**
 * 一条全局 SSE 连接。EventSource 自带重连并回带 Last-Event-ID，
 * 服务端有环形缓冲可重放，所以断线期间的任务结果不会丢。
 */
export function SseBridge({ enabled }: { enabled: boolean }): ReactElement | null {
  useEffect(() => {
    if (!enabled) return undefined;
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => emitSseOpen();
    es.onmessage = (m: MessageEvent<string>) => {
      let e: ServerEvent;
      try {
        e = JSON.parse(m.data) as ServerEvent;
      } catch {
        return;
      }
      emitServerEvent(e);
    };
    return () => es.close();
  }, [enabled]);
  return null;
}
