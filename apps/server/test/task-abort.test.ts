/**
 * 任务超时的语义：必须真的把 signal 吹掉，而不是"我不等了你继续跑"。
 * 以前的 withTimeout 只 reject，runner 背后的 fetch/poll 会跑完 —— 钱花了、结果丢了、并发槽还提前释放。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

// services/tasks 的依赖链会打开数据库，先把路径挪到临时库
const dir = mkdtempSync(join(tmpdir(), 'rt-abort-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'abort.db');
process.env.DATA_DIR = join(dir, 'data');

const { closeDb } = await import('../src/db/index');
const { withAbort, TaskTimeout } = await import('../src/services/tasks');

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('withAbort', () => {
  it('正常完成时不取消', async () => {
    const v = await withAbort(async () => 7, 500);
    assert.equal(v, 7);
  });

  it('超时会把 signal 吹给执行体', async () => {
    let sawAbort = false;
    const p = withAbort(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve(1);
          });
        }),
      40,
    );
    await assert.rejects(p, TaskTimeout);
    assert.equal(sawAbort, true, '执行体没收到取消，就等于没取消');
  });

  it('超时后迟到的成功不算数', async () => {
    const box: { resolve?: (n: number) => void } = {};
    const p = withAbort(
      () =>
        new Promise<number>((resolve) => {
          box.resolve = resolve;
        }),
      30,
    );
    await assert.rejects(p, TaskTimeout);
    box.resolve?.(99);
    const settled = await p.then(
      (v) => `resolved:${v}`,
      (e: Error) => `rejected:${e.constructor.name}`,
    );
    assert.equal(settled, 'rejected:TaskTimeout', '已经超时就不许再变成成功');
  });

  it('执行体自己的错误原样抛出，不被改写成超时', async () => {
    await assert.rejects(
      withAbort(async () => {
        throw new Error('上游返回 502');
      }, 500),
      /上游返回 502/,
    );
  });
});
