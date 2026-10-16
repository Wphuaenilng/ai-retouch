/**
 * 工具箱的能力门（D31 / 任务 4.9）。
 * 钉住一条口径：**置灰的依据必须和规划器用的是同一份能力集合**，
 * 并且"还没拿到配置"与"拿到了但做不到"是两件事 —— 前者一律放行，
 * 否则每个用户在 /api/config 回来之前都会看到一排灰按钮。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getTool,
  isToolServable,
  toolBlockedText,
  toolsByGroup,
  visibleTools,
  type Capability,
  type ToolDef,
} from '@retouch/shared';

// 只配百炼 + 中转站时的真实能力（两家实测下来只有这两项）
const WANX_PLUS_RELAY: Capability[] = ['text2image', 'edit'];
// 配上做得到局部重绘的上游时
const WITH_INPAINT: Capability[] = ['text2image', 'edit', 'inpaint'];

const nameOf = (t: ToolDef): string => t.title;

describe('能力门', () => {
  it('做不到的那六个 P0 工具在真实配置下确实被挡', () => {
    const blocked = visibleTools()
      .filter((t) => t.group === 'ai')
      .filter((t) => !isToolServable(t, WANX_PLUS_RELAY))
      .map(nameOf);
    for (const want of ['消除 / 去水印', '局部替换', '扩图', '超分放大', '抠图', '人像美化']) {
      assert.ok(blocked.includes(want), `「${want}」在没有对应能力时该被挡，实得 ${blocked.join('/')}`);
    }
    assert.equal(isToolServable(getTool('text2image')!, WANX_PLUS_RELAY), true);
    assert.equal(isToolServable(getTool('prompt_edit')!, WANX_PLUS_RELAY), true);
  });

  it('补上 inpaint 能力，消除就亮回来', () => {
    assert.equal(isToolServable(getTool('erase')!, WITH_INPAINT), true);
    assert.equal(isToolServable(getTool('inpaint_replace')!, WITH_INPAINT), true);
  });

  it('本地工具没有 capability，任何配置下都不该被挡', () => {
    for (const t of toolsByGroup('local')) {
      assert.equal(isToolServable(t, WANX_PLUS_RELAY), true, `${t.title} 是本地工具，不该看上游脸色`);
    }
    assert.equal(isToolServable(getTool('adjust')!, []), true, '空能力集合也拦不住本地工具');
  });

  it('还没拿到配置 = 一律放行，不一闪而过地灰一整排', () => {
    for (const t of visibleTools()) {
      assert.equal(isToolServable(t, null), true, `${t.title} 在 caps=null 时不该被挡`);
    }
  });

  it('灰掉时给的是人话能力名，不是裸的 inpaint', () => {
    const text = toolBlockedText(getTool('erase')!);
    assert.match(text, /按选区局部重绘/);
    assert.doesNotMatch(text, /\binpaint\b/, '用户不需要认识内部能力 id');
  });

  it('默认选中的工具正好是会被挡的那种，所以自动换掉那步不是多余的', () => {
    const defaultTool = getTool('cutout')!;
    assert.equal(isToolServable(defaultTool, WANX_PLUS_RELAY), false, '默认值若改了，这条守卫的必要性要重新评估');
  });
});
