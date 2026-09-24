import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validatePlan, type PlanFacts } from '../src/agent/validator';

const facts: PlanFacts = {
  currentImageId: 'im_existing',
  hasSelection: false,
  maskImageId: null,
  layerIds: ['L1', 'L2'],
  hasMultipleImages: false,
};

describe('计划校验器', () => {
  it('拒绝注册表里没有的工具', () => {
    const r = validatePlan({ steps: [{ id: 's1', tool: 'make_video', params: {}, deps: [] }] }, facts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(), /不存在的工具/);
  });

  it('缺 imageId 时用当前图片补全，并给出警告', () => {
    const r = validatePlan({ steps: [{ id: 's1', tool: 'upscale', params: {}, deps: [] }] }, facts);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.steps[0]!.params.imageId, 'im_existing');
      assert.equal(r.warnings.length, 1);
    }
  });

  it('需要选区的工具在没有选区时报错', () => {
    const r = validatePlan({ steps: [{ id: 's1', tool: 'erase', params: { imageId: 'im_existing' }, deps: [] }] }, facts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(), /先.*涂抹|框选/);
  });

  it('有选区时自动引用选区遮罩', () => {
    const r = validatePlan(
      { steps: [{ id: 's1', tool: 'erase', params: { imageId: 'im_existing' }, deps: [] }] },
      { ...facts, hasSelection: true, maskImageId: 'im_mask' },
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.steps[0]!.params.maskImageId, 'im_mask');
  });

  it('参数越界被 zod 拒绝', () => {
    const r = validatePlan({ steps: [{ id: 's1', tool: 'adjust', params: { brightness: 9 }, deps: [] }] }, facts);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(), /brightness/);
  });

  it('检出依赖成环', () => {
    const r = validatePlan(
      {
        steps: [
          { id: 's1', tool: 'upscale', params: {}, deps: ['s2'] },
          { id: 's2', tool: 'cutout', params: {}, deps: ['s1'] },
        ],
      },
      facts,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(), /成环/);
  });

  it('按依赖做拓扑排序，不依赖模型给的顺序', () => {
    const r = validatePlan(
      {
        steps: [
          { id: 's2', tool: 'adjust', params: {}, deps: ['s1'] },
          { id: 's1', tool: 'cutout', params: {}, deps: [] },
        ],
      },
      facts,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(
        r.steps.map((s) => s.tool),
        ['cutout', 'adjust'],
      );
      assert.deepEqual(r.steps[1]!.deps, [0]);
    }
  });

  it('引用了不存在的 deps 会被丢弃而不是报错', () => {
    const r = validatePlan(
      {
        steps: [
          { id: 's1', tool: 'cutout', params: {}, deps: [] },
          { id: 's2', tool: 'upscale', params: {}, deps: ['nope'] },
        ],
      },
      facts,
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.steps[1]!.deps, []);
  });

  it('不存在的 layerId 会被清掉并警告', () => {
    const r = validatePlan(
      { steps: [{ id: 's1', tool: 'adjust', params: { layerId: 'L99', brightness: 0.1 }, deps: [] }] },
      facts,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.steps[0]!.params.layerId, undefined);
      assert.match(r.warnings.join(), /图层不存在/);
    }
  });
});
