/**
 * 能力过滤（任务 4.3 / D27）：当前 provider 配置做不到的能力，
 * 要在模型"看得见"和计划"落得下"两处都被排除。
 * 等到任务跑起来才报"没有可用模型"，人已经等十几秒、配额还先扣了一次。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toolServableBy, toolSpecForPlanner } from '@retouch/shared';
import { validatePlan } from '../src/agent/validator';

const FACTS = { currentImageId: 'im_1', maskImageId: null, hasSelection: true, layerIds: ['L1'], hasMultipleImages: false };
const SEEDREAM_LIKE = ['text2image', 'edit', 'inpaint', 'outpaint', 'upscale']; // 没有 portrait / segment

describe('工具清单按能力生成', () => {
  it('不传能力 = 全给；传了就只给做得到的', () => {
    assert.match(toolSpecForPlanner(), /portrait_beautify/);
    assert.match(toolSpecForPlanner(), /cutout/);
    const spec = toolSpecForPlanner(SEEDREAM_LIKE);
    assert.doesNotMatch(spec, /portrait_beautify/, 'Seedream-only 配置不该让人像美化进提示');
    assert.doesNotMatch(spec, /(^|\n)- cutout（/, 'cutout 依赖 segment，同样不该出现');
    assert.match(spec, /replace_background/, 'edit 能力在，换背景该在');
  });

  it('本地工具没有 capability，任何配置下都可见', () => {
    assert.match(toolSpecForPlanner([]), /adjust|crop/);
  });
});

describe('toolServableBy', () => {
  it('能力在集合内才可服务；未知工具一律不可', () => {
    assert.equal(toolServableBy('upscale', SEEDREAM_LIKE), true);
    assert.equal(toolServableBy('portrait_beautify', SEEDREAM_LIKE), false);
    assert.equal(toolServableBy('portrait_beautify', [...SEEDREAM_LIKE, 'portrait']), true);
    assert.equal(toolServableBy('nope', SEEDREAM_LIKE), false);
  });
});

describe('校验器丢掉做不到的步骤', () => {
  it('丢掉的那步给警告，留下的照常通过', () => {
    const r = validatePlan(
      {
        summary: 's',
        steps: [
          { id: 's1', tool: 'portrait_beautify', params: { strength: 0.4 }, deps: [] },
          { id: 's2', tool: 'upscale', params: { scale: 2 }, deps: ['s1'] },
        ],
      },
      FACTS,
      SEEDREAM_LIKE,
    );
    assert.ok(r.ok, '还剩一步可用的计划不该整体判失败');
    assert.equal(r.steps.length, 1);
    assert.equal(r.steps[0]?.tool, 'upscale');
    assert.ok(
      r.warnings.some((w) => w.includes('人像美化') && w.includes('跳过')),
      `该有跳过说明，实得 ${JSON.stringify(r.warnings)}`,
    );
  });

  it('不传能力集合时行为不变（离线与既有测试不受影响）', () => {
    const r = validatePlan(
      { summary: 's', steps: [{ id: 's1', tool: 'portrait_beautify', params: { strength: 0.4 }, deps: [] }] },
      FACTS,
    );
    assert.ok(r.ok);
    assert.equal(r.steps[0]?.tool, 'portrait_beautify');
  });

  it('全部步骤都做不到时判失败并说清原因，而不是产出一个空计划', () => {
    const r = validatePlan(
      { summary: 's', steps: [{ id: 's1', tool: 'portrait_beautify', params: {}, deps: [] }] },
      FACTS,
      SEEDREAM_LIKE,
    );
    assert.equal(r.ok, false);
    // 联合类型：ok:false 分支只有 errors —— 要的是"说清为什么做不到"，不是空计划
    if (!r.ok)
      assert.ok(
        r.errors.some((e) => e.length > 0),
        `失败要有可读原因，实得 ${JSON.stringify(r.errors)}`,
      );
  });
});
