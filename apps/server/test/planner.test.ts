import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mockPlan } from '../src/agent/planner';
import { validatePlan, type PlanFacts } from '../src/agent/validator';

const facts: PlanFacts = {
  currentImageId: 'im_1',
  hasSelection: false,
  maskImageId: null,
  layerIds: ['L1'],
  hasMultipleImages: false,
};

const toolsFor = (msg: string, f = facts) => mockPlan({ message: msg, facts: f }).draft.steps.map((s) => s.tool);

describe('规则式规划器', () => {
  it('换背景只用一个 replace_background 步骤', () => {
    assert.deepEqual(toolsFor('把背景换成纯白'), ['replace_background']);
    const step = mockPlan({ message: '把背景换成纯白', facts }).draft.steps[0]!;
    assert.equal(step.params.color, '#ffffff');
  });

  it('识别米白这类颜色词', () => {
    const step = mockPlan({ message: '背景换成米白摄影棚', facts }).draft.steps[0]!;
    assert.equal(step.params.color, '#f3efe8');
  });

  it('组合需求拆成多步并按顺序依赖', () => {
    const draft = mockPlan({ message: '把背景换成纯白，然后裁成 1:1，再亮一点', facts }).draft;
    assert.deepEqual(draft.steps.map((s) => s.tool), ['replace_background', 'transform', 'adjust']);
    assert.deepEqual(draft.steps[2]!.deps, ['s2']);
    const v = validatePlan(draft, facts);
    assert.equal(v.ok, true);
  });

  it('有选区时"去掉水印"走 erase，没有选区走 remove_text', () => {
    assert.deepEqual(toolsFor('去掉水印'), ['remove_text']);
    assert.deepEqual(toolsFor('去掉水印', { ...facts, hasSelection: true, maskImageId: 'im_mask' }), ['erase']);
  });

  it('超分与放大走 upscale，"清晰一点"走 adjust.sharpness', () => {
    assert.deepEqual(toolsFor('把图放大 4 倍'), ['upscale']);
    const step = mockPlan({ message: '把图放大 4 倍', facts }).draft.steps[0]!;
    assert.equal(step.params.scale, 4);
    const s2 = mockPlan({ message: '清晰一点', facts }).draft.steps[0]!;
    assert.equal(s2.tool, 'adjust');
    assert.ok((s2.params.sharpness as number) > 0);
  });

  it('黑白、暖调、暗角都落到 adjust 的具体参数', () => {
    assert.equal(mockPlan({ message: '转成黑白', facts }).draft.steps[0]!.params.saturation, -1);
    assert.ok((mockPlan({ message: '色调再暖一点', facts }).draft.steps[0]!.params.temperature as number) > 0);
    assert.ok((mockPlan({ message: '加一点暗角', facts }).draft.steps[0]!.params.vignette as number) > 0);
  });

  it('做不到的需求明确拒绝而不是硬凑', () => {
    assert.throws(() => mockPlan({ message: '把这张图做成 15 秒视频', facts }), /暂时做不到/);
  });

  it('导出意图产生 export 步骤（客户端执行）', () => {
    const step = mockPlan({ message: '导出成 webp', facts }).draft.steps.at(-1)!;
    assert.equal(step.tool, 'export');
  });
});
