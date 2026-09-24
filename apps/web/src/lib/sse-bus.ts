import { useEffect, useRef } from 'react';
import type { ServerEvent } from '@retouch/shared';

/**
 * SSE 事件总线（非组件模块）：SseBridge 往里灌，各面板用 useEvent 订阅。
 * 单独成文件是因为 react-refresh 要求组件文件只导出组件 —— 总线和组件混在一起，
 * 热更新时整个模块会被当成非组件而失去 fast refresh。
 */
type Handler = (e: ServerEvent) => void | Promise<void>;
const listeners = new Set<Handler>();
const opens = new Set<() => void>();

export function onServerEvent(h: Handler): () => void {
  listeners.add(h);
  return () => listeners.delete(h);
}

/** 连接建立或重连时回调；用来主动拉一次进行中任务，兜住 SSE 之外错过的终态 */
export function onSseOpen(cb: () => void): () => void {
  opens.add(cb);
  return () => opens.delete(cb);
}

export function emitServerEvent(e: ServerEvent): void {
  // 一个订阅者抛错不该让其余面板从此收不到事件
  for (const h of [...listeners]) void (async () => h(e))().catch((err) => console.error('[sse] 事件处理失败', err));
}

export function emitSseOpen(): void {
  for (const f of [...opens]) f();
}

/** 订阅某一类服务端事件；handler 用 ref 持有，调用方不必管依赖数组 */
export function useEvent<T extends ServerEvent['type']>(
  type: T,
  cb: (e: Extract<ServerEvent, { type: T }>) => void | Promise<void>,
): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onServerEvent((e) => void (e.type === type && (ref.current as unknown as (x: ServerEvent) => void)(e))), [type]);
}
