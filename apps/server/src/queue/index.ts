import { config } from '../config';
import { claimNextTask, reapStaleRunning, type TaskRow } from '../store/tasks';
import { executeTask } from '../services/tasks';
import { onWakeup } from './signal';

/**
 * 持久化任务队列：任务表本身就是队列（status=queued 即待办），
 * 进程内 worker 按并发上限领取。好处是零额外依赖、重启不丢任务；
 * 换成 pg-boss / BullMQ 时只需要替换 claim() 与 wake() 两处。
 */
class Worker {
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private waking = false;
  private stopped = false;
  private offWakeup: (() => void) | null = null;

  start(): void {
    const stale = reapStaleRunning();
    if (stale) console.log(`[queue] 回收上次中断的任务 ${stale} 个`);
    this.stopped = false;
    this.offWakeup = onWakeup(() => this.wake());
    this.timer = setInterval(() => this.drain(), 400);
    this.timer.unref?.();
    this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.offWakeup?.();
    this.offWakeup = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  wake(): void {
    if (this.waking) return;
    this.waking = true;
    setImmediate(() => {
      this.waking = false;
      this.drain();
    });
  }

  private drain(): void {
    if (this.stopped) return;
    while (this.running < config.WORKER_CONCURRENCY) {
      const task = claimNextTask();
      if (!task) return;
      this.running += 1;
      void this.runOne(task);
    }
  }

  private async runOne(task: TaskRow): Promise<void> {
    try {
      await executeTask(task);
    } catch (e) {
      // executeTask 内部已兜底，这里只防意外穿透导致 worker 卡死
      console.error('[queue] worker 未捕获异常', e);
    } finally {
      this.running -= 1;
      this.wake();
    }
  }

  get stats(): { running: number; concurrency: number } {
    return { running: this.running, concurrency: config.WORKER_CONCURRENCY };
  }
}

export const worker = new Worker();
