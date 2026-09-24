/**
 * 计划执行锁：同一时刻只能有一个执行器在写某个计划。
 * 以前 approve / retry / skip 都能各自触发一次执行，两个执行器对同一份 steps
 * JSON 读-改-写，状态互相覆盖、坏的一步还可能被跑两遍（重复扣钱）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rt-planlock-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'pl.db');
process.env.DATA_DIR = join(dir, 'data');

const { closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const p = await import('../src/store/plans');

migrate();

const USER = 'us_lock';
const DOC = 'dc_lock';

function makePlan(): string {
  const row = p.insertPlan({
    userId: USER,
    documentId: DOC,
    userMessage: '换背景再变亮',
    planner: 'mock-rules',
    steps: [
      {
        idx: 0,
        tool: 'replace_background',
        params: { color: '#ffffff' },
        deps: [],
        executor: 'server',
        title: '换背景',
        status: 'pending',
        taskId: null,
        error: null,
      },
    ],
  });
  return row.id;
}

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('计划执行锁', () => {
  it('同一个计划只能被抢一次', () => {
    const id = makePlan();
    assert.equal(p.claimPlan(id, 'A'), true);
    assert.equal(p.claimPlan(id, 'B'), false, '第二把钥匙不该拿到锁');
    assert.equal(p.findPlan(id)?.exec_token, 'A');
    p.releasePlan(id, 'A');
  });

  it('带错误令牌的写入被拒绝，带对的才生效', () => {
    const id = makePlan();
    p.claimPlan(id, 'A');
    const steps = p.planSteps(p.findPlan(id)!);

    assert.equal(p.savePlan(id, { status: 'done', steps }, 'B'), undefined, '拿着别人的令牌不该写成');
    assert.equal(p.findPlan(id)?.status, 'proposed');

    assert.equal(p.savePlan(id, { status: 'done', steps }, 'A')?.status, 'done');
    p.releasePlan(id, 'A');
  });

  it('释放后可以被再次抢占；release 只认自己的令牌', () => {
    const id = makePlan();
    p.claimPlan(id, 'A');
    p.releasePlan(id, 'B');
    assert.equal(p.findPlan(id)?.exec_token, 'A', '别人不能替我解锁');
    p.releasePlan(id, 'A');
    assert.equal(p.findPlan(id)?.exec_token, null);
    assert.equal(p.claimPlan(id, 'C'), true);
    p.releasePlan(id, 'C');
  });

  it('重启时把上次残留的锁全部放开', () => {
    const a = makePlan();
    const b = makePlan();
    p.claimPlan(a, '死掉的执行器');
    p.claimPlan(b, '另一个死掉的');
    assert.equal(p.claimPlan(a, '新的'), false, '重启前抢不到');
    assert.equal(p.resetPlanLocks(), 2);
    assert.equal(p.claimPlan(a, '新的'), true);
    p.releasePlan(a, '新的');
    assert.equal(p.resetPlanLocks(), 0, '没有锁时不该报成释放了东西');
  });
});
