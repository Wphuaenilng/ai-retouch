type Handler = () => void;
import { log } from '../lib/log';

const handlers = new Set<Handler>();

/** 解耦用：任务服务只喊一声"有活了"，worker 自己订阅，避免模块循环引用 */
export function onWakeup(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

export function wakeWorker(): void {
  for (const h of handlers) {
    try {
      h();
    } catch (e) {
      log.error('wake 处理异常', { err: e instanceof Error ? e.message : String(e) });
    }
  }
}
