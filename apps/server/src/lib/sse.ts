import type { ServerEvent } from '@retouch/shared';
import type { FastifyReply } from 'fastify';

interface Sub {
  id: number;
  userId: string;
  raw: NodeJS.WritableStream & { end?: () => void };
  alive: boolean;
}

const RING_SIZE = 200;
const HEARTBEAT_MS = 15_000;

/**
 * SSE 事件总线：按用户隔离频道，每人保留最近 200 条用于断线重放。
 * 生产环境（Caddy/Nginx）必须关掉响应缓冲，否则进度条不动 —— 已用
 * X-Accel-Buffering: no 与 no-transform 双保险。
 */
class Hub {
  private subs = new Map<number, Sub>();
  private seq = new Map<string, number>();
  private ring = new Map<string, { id: string; data: string }[]>();
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;

  publish(userId: string, event: ServerEvent): void {
    const n = (this.seq.get(userId) ?? 0) + 1;
    this.seq.set(userId, n);
    const id = String(n);
    const data = JSON.stringify(event);

    const list = this.ring.get(userId) ?? [];
    list.push({ id, data });
    if (list.length > RING_SIZE) list.splice(0, list.length - RING_SIZE);
    this.ring.set(userId, list);

    for (const s of this.subs.values()) {
      if (s.userId === userId) this.writeFrame(s, id, data);
    }
  }

  /** 返回 true 表示流已建立（调用方需 hijack reply） */
  attach(userId: string, raw: NodeJS.WritableStream, lastEventId?: string): () => void {
    const sub: Sub = { id: this.nextId++, userId, raw: raw as Sub['raw'], alive: true };
    this.subs.set(sub.id, sub);
    this.startHeartbeat();

    raw.write(`retry: 3000\n\n`);
    const list = this.ring.get(userId) ?? [];
    const from = Number(lastEventId ?? '0');
    if (Number.isFinite(from) && from > 0) {
      for (const e of list) if (Number(e.id) > from) this.writeFrame(sub, e.id, e.data);
    } else {
      for (const e of list.slice(-20)) this.writeFrame(sub, e.id, e.data);
    }

    return () => {
      sub.alive = false;
      this.subs.delete(sub.id);
      if (this.subs.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private writeFrame(sub: Sub, id: string, data: string): void {
    if (!sub.alive) return;
    try {
      sub.raw.write(`id: ${id}\ndata: ${data}\n\n`);
    } catch {
      sub.alive = false;
      this.subs.delete(sub.id);
    }
  }

  private startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const s of this.subs.values()) {
        try {
          s.raw.write(`: ping ${Date.now()}\n\n`);
        } catch {
          s.alive = false;
          this.subs.delete(s.id);
        }
      }
    }, HEARTBEAT_MS);
    this.timer.unref?.();
  }

  get connectionCount(): number {
    return this.subs.size;
  }
}

export const hub = new Hub();

/** 把 reply 变成 SSE 流；调用前必须 reply.hijack() */
export function openEventStream(reply: FastifyReply, userId: string, lastEventId?: string): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const detach = hub.attach(userId, reply.raw, lastEventId);
  reply.raw.on('close', detach);
}
