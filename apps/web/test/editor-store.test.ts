/**
 * 编辑器状态层的行为。画布渲染要真浏览器才能看，但"改了没、能不能撤销、
 * 自动保存会不会吞编辑"这些是纯状态逻辑，全部可测。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { baseCanvas, type DocumentDTO } from '@retouch/shared';
import { useEditor } from '../src/state/editor';

const canvas = () => ({
  ...baseCanvas(800, 600, 'im_base', '原图'),
  layers: baseCanvas(800, 600, 'im_base', '原图').layers.map((l) => ({ ...l })),
});

const docFixture = (): DocumentDTO => ({
  id: 'dc_test',
  title: '测试',
  canvas: canvas(),
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
});

const s = () => useEditor.getState();

beforeEach(() => {
  s().setDoc(docFixture());
});

describe('历史与脏标记', () => {
  it('commit 入栈并标脏，undo 精确回到上一版', () => {
    const before = s().doc!.canvas;
    s().commit((c) => ({ ...c, width: 1000 }));
    assert.equal(s().doc!.canvas.width, 1000);
    assert.equal(s().dirty, true);
    assert.equal(s().past.length, 1);

    s().undo();
    assert.deepEqual(s().doc!.canvas, before);
    assert.equal(s().dirty, true, '撤销本身也是一次改动，仍然要保存');
  });

  it('20 步混合操作能一路撤销回去', () => {
    for (let i = 0; i < 20; i += 1) s().commit((c) => ({ ...c, height: 600 + i }));
    assert.equal(s().past.length, 20);
    for (let i = 0; i < 20; i += 1) s().undo();
    assert.equal(s().doc!.canvas.height, 600);
    assert.equal(s().past.length, 0);
  });

  it('历史栈封顶 50 步', () => {
    for (let i = 0; i < 60; i += 1) s().commit((c) => ({ ...c, width: i }));
    assert.equal(s().past.length, 50);
  });

  it('新提交会清空重做栈', () => {
    s().commit((c) => ({ ...c, width: 1 }));
    s().undo();
    assert.equal(s().future.length, 1);
    s().commit((c) => ({ ...c, width: 2 }));
    assert.equal(s().future.length, 0);
  });

  it('选中图层会标脏但不占历史', () => {
    const id = s().doc!.canvas.layers[0].id;
    const past = s().past.length;
    s().setActive(id);
    assert.equal(s().dirty, true);
    assert.equal(s().past.length, past, '换个选中项不该产生一步撤销');
  });
});

describe('自动保存的版本号语义', () => {
  it('回包只清"发出去那一版"的脏标记', () => {
    s().commit((c) => ({ ...c, width: 700 }));
    const sent = s().version;
    // PATCH 在飞期间用户又改了一笔
    s().commit((c) => ({ ...c, width: 900 }));
    s().markSaved('2026-09-24T00:01:00.000Z', sent);
    assert.equal(s().dirty, true, '在飞期间的新改动不能被记成已保存');
    assert.equal(s().doc!.canvas.width, 900);

    s().markSaved('2026-09-24T00:02:00.000Z', s().version);
    assert.equal(s().dirty, false);
    assert.equal(s().savedAt, '2026-09-24T00:02:00.000Z');
  });
});

describe('图层操作', () => {
  it('applyLayers 拆出主体层与背景层，原图隐藏但保留', () => {
    s().applyLayers(
      [
        { name: '主体层', imageId: 'im_subject' },
        { name: '背景层', imageId: 'im_background' },
      ],
      true,
    );
    const c = s().doc!.canvas;
    assert.equal(c.layers.length, 3);
    assert.equal(c.layers[1].imageId, 'im_subject');
    assert.equal(c.layers[2].imageId, 'im_background');
    assert.equal(c.layers[0].visible, false);
    assert.equal(c.activeLayerId, c.layers[1].id);
    assert.equal(s().past.length, 1, '一次拆分应该是一步撤销');

    s().undo();
    assert.equal(s().doc!.canvas.layers.length, 1);
  });

  it('moveLayer 交换相邻层，边界处不产生空历史', () => {
    s().applyLayers([
      { name: 'A', imageId: 'im_a' },
      { name: 'B', imageId: 'im_b' },
    ]);
    const c0 = s().doc!.canvas;
    const top = c0.layers[2];
    const past = s().past.length;
    s().moveLayer(top.id, 1); // 已经在数组末尾
    assert.equal(s().past.length, past, '按边界不该记一步');
    assert.deepEqual(s().doc!.canvas, c0);

    s().moveLayer(top.id, -1);
    assert.equal(s().doc!.canvas.layers[1].id, top.id);
    assert.equal(s().past.length, past + 1);
  });

  it('不透明度被夹在 0~1，且真进了文档', () => {
    const id = s().doc!.canvas.layers[0].id;
    s().setLayerOpacity(id, 2);
    assert.equal(s().doc!.canvas.layers[0].opacity, 1);
    s().setLayerOpacity(id, -0.5);
    assert.equal(s().doc!.canvas.layers[0].opacity, 0);
    s().setLayerOpacity(id, 0.4);
    assert.equal(s().doc!.canvas.layers[0].opacity, 0.4);
  });

  it('删除最后一层里的第二层会把选中项挪到剩下那层', () => {
    s().applyLayers([
      { name: 'A', imageId: 'im_a' },
      { name: 'B', imageId: 'im_b' },
    ]);
    const active = s().doc!.canvas.activeLayerId;
    assert.ok(active);
    s().removeLayer(active);
    const c = s().doc!.canvas;
    assert.equal(c.layers.length, 2);
    assert.notEqual(c.activeLayerId, active);
    assert.ok(c.layers.some((l) => l.id === c.activeLayerId));
  });
});
