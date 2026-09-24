/**
 * 配额账本的幂等性：一次预扣只能被结算或退还一次。
 * 以前 charged 这一列写了却没人读，重启回收的中断任务也不退配额 —— 这里把它钉住。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

// store/* 通过 config 打开数据库，所以必须在动态 import 之前把路径指到临时库
const dir = mkdtempSync(join(tmpdir(), 'rt-ledger-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'ledger.db');
process.env.DATA_DIR = join(dir, 'data');

const { run, get, closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const tasks = await import('../src/store/tasks');
const usage = await import('../src/store/usage');

migrate();

const USER = 'us_ledger';
const calls = (): number => usage.getUsage(USER).ai_calls;

function makeTask(): string {
  const row = tasks.insertTask({ userId: USER, tool: 'prompt_edit', params: { imageId: 'im_x', prompt: 'x' } });
  usage.precountCall(USER);
  return row.id;
}

after(() => {
  closeDb(); // 不先关连接，Windows 上删不掉临时库
  rmSync(dir, { recursive: true, force: true });
});

describe('配额账本', () => {
  it('一次预扣只退一次', () => {
    const c0 = calls();
    const id = makeTask();
    assert.equal(calls(), c0 + 1, '预扣应该 +1');
    assert.equal(tasks.markRefunded(id), true, '第一次翻牌应该成功');
    usage.refundCall(USER);
    assert.equal(calls(), c0);
    assert.equal(tasks.markRefunded(id), false, '第二次翻牌必须失败');
  });

  it('已结算成本的任务不能再退', () => {
    const id = makeTask();
    tasks.markSucceeded(id, 'im_result', 0.26, { ok: 1 });
    const row = get<{ charged: number }>('SELECT charged FROM tasks WHERE id = ?', id);
    assert.equal(row?.charged, 1);
    assert.equal(tasks.markRefunded(id), false, '结算过的行不能被当成退款');
  });

  it('手动重试重新预扣后，新的这次仍然可退', () => {
    const c0 = calls();
    const id = makeTask();
    tasks.markFailed(id, 'PROVIDER_TIMEOUT', '超时');
    assert.equal(tasks.markRefunded(id), true);
    usage.refundCall(USER);
    assert.equal(calls(), c0);

    assert.equal(tasks.requeue(id, USER), true);
    usage.precountCall(USER);
    const row = get<{ charged: number; status: string }>('SELECT charged, status FROM tasks WHERE id = ?', id);
    assert.equal(row?.status, 'queued');
    assert.equal(row?.charged, 0, '重排队必须把 charged 归零，否则这次的预扣永远退不回来');
    assert.equal(tasks.markRefunded(id), true);
  });

  it('自动重排（retriable 失败）不退款也不翻牌', () => {
    const id = makeTask();
    tasks.markFailed(id, 'PROVIDER_TIMEOUT', '超时', { requeue: true });
    const row = get<{ charged: number; status: string }>('SELECT charged, status FROM tasks WHERE id = ?', id);
    assert.equal(row?.status, 'queued');
    assert.equal(row?.charged, 0, '整条链路只预扣一次，重排时不该翻牌');
  });

  it('重启回收：中断任务判失败并只退还未结算的那些', () => {
    const a = makeTask(); // 未结算 → 该退
    const b = makeTask(); // 已结算 → 不该退
    tasks.markSucceeded(b, 'im_result', 0.26);
    const beforeCalls = calls();
    run("UPDATE tasks SET status = 'running' WHERE id IN (?, ?)", a, b);

    const r = tasks.reapStaleRunning();
    assert.equal(r.count, 2);
    assert.equal(r.refundUserIds.length, 1, '只有 charged=0 的行需要退');
    usage.refundCall(USER);
    assert.equal(calls(), beforeCalls - 1);

    const again = tasks.reapStaleRunning();
    assert.equal(again.count, 0, '同一批不能退两次');
    assert.deepEqual(again.refundUserIds, []);
  });
});
