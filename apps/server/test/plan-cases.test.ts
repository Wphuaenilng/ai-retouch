/**
 * M4 的固定验收集（原 02-执行方案.md §M4 的 5 条），落成可回归的测试。
 * 这里是"计划层"的承诺：工具序列、前后端混排、事实补全、依赖重排后仍然有效。
 * 第 5 条（执行中杀掉一个上游调用）必须有真实上游，见 docs/05 阶段 4。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTool } from '@retouch/shared';
import { mockPlan } from '../src/agent/planner';
import { validatePlan, type PlanFacts } from '../src/agent/validator';

const facts: PlanFacts = {
  currentImageId: 'im_current',
  hasSelection: false,
  maskImageId: null,
  layerIds: ['L1'],
  hasMultipleImages: false,
};

function planFor(message: string, f = facts) {
  const draft = mockPlan({ message, facts: f }).draft;
  const r = validatePlan(draft, f);
  if (!r.ok) throw new Error(`计划被拒绝：${r.errors.join('；')}`);
  return r;
}

/** 拓扑排序之后，每条依赖都必须指向更早的步骤——执行器就是靠这个顺序传中间结果的 */
function assertDepsPointBack(steps: { idx: number; deps: number[] }[]): void {
  for (const s of steps) {
    for (const d of s.deps) {
      assert.ok(d < s.idx, `步骤 ${s.idx} 依赖了不靠前的 ${d}`);
      assert.ok(
        steps.some((x) => x.idx === d),
        `步骤 ${s.idx} 依赖了不存在的 ${d}`,
      );
    }
  }
}

describe('M4 验收 1：换背景 + 裁 1:1', () => {
  const r = planFor('把背景换成纯白，然后把图片裁成 1:1');

  it('正好两步，顺序是先服务端后前端', () => {
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ['replace_background', 'transform'],
    );
    assert.deepEqual(
      r.steps.map((s) => s.executor),
      ['server', 'client'],
    );
  });

  it('参数被正确钳制', () => {
    assert.equal(r.steps[0].params.color, '#ffffff');
    assert.equal(r.steps[1].params.cropRatio, '1:1');
  });

  it('imageId 由当前图片事实补全，并带一句警告', () => {
    assert.equal(r.steps[0].params.imageId, 'im_current');
    assert.ok(r.warnings.some((w) => w.includes('当前图片')));
  });

  it('依赖指向步骤 0', () => {
    assertDepsPointBack(r.steps);
    assert.deepEqual(r.steps[1].deps, [0]);
  });
});

describe('M4 验收 2：先画选区再消除', () => {
  const withSel: PlanFacts = { ...facts, hasSelection: true, maskImageId: 'im_mask' };

  it('有选区时走 erase，并自动引用现有选区', () => {
    const r = planFor('去掉左上角的水印', withSel);
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ['erase'],
    );
    assert.equal(r.steps[0].params.maskImageId, 'im_mask');
    assert.equal(r.steps[0].params.imageId, 'im_current');
    assert.ok(r.warnings.some((w) => w.includes('选区')));
  });

  it('没有选区时退到 remove_text（不阻塞用户）', () => {
    const r = planFor('去掉左上角的水印');
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ['remove_text'],
    );
  });

  it('需要选区却没有选区的工具，会被校验器挡下来', () => {
    const draft = mockPlan({ message: '去掉水印', facts }).draft;
    const only = { ...draft, steps: draft.steps.map((s) => ({ ...s, tool: 'inpaint_replace' })) };
    const r = validatePlan(only, facts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => /选区|maskImageId/.test(e)));
  });
});

describe('M4 验收 3：超分 4x 后转黑白（前后端混排）', () => {
  const r = planFor('先超分到 4 倍，再调成黑白');

  it('顺序正确：服务端步骤在前，客户端调色在后', () => {
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ['upscale', 'adjust'],
    );
    assert.deepEqual(
      r.steps.map((s) => getTool(s.tool)?.executor),
      ['server', 'client'],
    );
  });

  it('参数分别落到 scale 与 saturation', () => {
    assert.equal(r.steps[0].params.scale, 4);
    assert.equal(r.steps[1].params.saturation, -1);
  });

  it('依赖链在重排后仍然自洽', () => {
    assertDepsPointBack(r.steps);
    assert.deepEqual(r.steps[1].deps, [0]);
  });
});

describe('M4 验收 4：做不到的需求不产垃圾计划', () => {
  it('把图变成视频被直接拒绝', () => {
    assert.throws(() => mockPlan({ message: '把这张图变成一段视频', facts }), /暂时做不到/);
  });

  it('空计划被校验器拒绝', () => {
    const r = validatePlan({ summary: '', steps: [] as never[] }, facts);
    assert.equal(r.ok, false);
  });

  it('引用不存在的工具时整份计划不予通过', () => {
    const draft = mockPlan({ message: '把背景换成纯白', facts }).draft;
    const broken = { ...draft, steps: [{ ...draft.steps[0], tool: 'make_coffee' }] };
    const r = validatePlan(broken, facts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => /不存在的工具/.test(e)));
  });
});

describe('M4 验收 5：单步失败后的恢复', () => {
  it.skip('执行中杀掉一个上游调用：单步失败、已完成步骤保留、可单步重试（需真实上游，见 docs/05 阶段 4）');
});
