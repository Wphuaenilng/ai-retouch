/**
 * 画布几何的数学验证（02 §M3 常见坑要求的"先写坐标换算单测"）。
 * 这里盯的是三类一旦错了就表现为"手柄漂移/图层飞走"的问题。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IDENTITY,
  applyToPoint,
  artMatrix,
  centerPivot,
  compose,
  contentToStage,
  decompose,
  invert,
  mul,
  nearly,
  stageToContent,
  type LayerTransform,
  type Mat,
} from '../src/lib/artboard';

const SIZE = { w: 800, h: 600 };

const close = (m: Mat, want: Mat): void => {
  for (let i = 0; i < 6; i += 1) assert.ok(nearly(m[i], want[i]), `矩阵第 ${i} 位 ${m[i]} ≠ ${want[i]}`);
};

const same = (t: LayerTransform, e: LayerTransform): void => {
  close(compose(t), compose(e));
};

describe('矩阵', () => {
  it('compose 是 translate → rotate → scale', () => {
    close(compose({ x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 }), [1, 0, 0, 1, 10, 20]);
    // 90°：内容 (1,0) 落到 (0,1)
    const m = compose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 });
    close(m, [0, 1, -1, 0, 0, 0]);
    assert.deepEqual(
      { x: Math.round(applyToPoint(m, { x: 1, y: 0 }).x), y: Math.round(applyToPoint(m, { x: 1, y: 0 }).y) },
      { x: 0, y: 1 },
    );
  });

  it('m · m⁻¹ = 单位矩阵（含带旋转、非等比与镜像的组合）', () => {
    const cases: LayerTransform[] = [
      { x: 3, y: -8, scaleX: 1, scaleY: 1, rotation: 0 },
      { x: 120, y: 45, scaleX: 2, scaleY: 0.5, rotation: 33 },
      { x: -60, y: 900, scaleX: -1, scaleY: 1, rotation: 90 },
      { x: 0.001, y: 0, scaleX: -1.7, scaleY: 2.3, rotation: -145 },
    ];
    for (const t of cases) {
      const m = compose(t);
      close(mul(m, invert(m)), IDENTITY);
      close(mul(invert(m), m), IDENTITY);
    }
  });

  it('decompose ∘ compose 还原变换本身，镜像不会被读成转了 180°', () => {
    const cases: LayerTransform[] = [
      { x: 40, y: 50, scaleX: 1, scaleY: 1, rotation: 0 },
      { x: 40, y: 50, scaleX: 1.25, scaleY: 0.8, rotation: 90 },
      { x: -12, y: 7, scaleX: 1, scaleY: 1, rotation: -60 },
      { x: 5, y: 5, scaleX: -1, scaleY: 1, rotation: 0 },
      { x: 5, y: 5, scaleX: -1, scaleY: 1, rotation: 90 },
    ];
    for (const t of cases) {
      same(decompose(compose(t)), t);
      const back = decompose(compose(t));
      if (t.scaleX < 0) assert.ok(back.scaleX < 0, '镜像层的符号不能丢');
      if (t.rotation === 0 && t.scaleY > 0) assert.ok(nearly(back.rotation, 0), '纯镜像不该产生旋转');
    }
  });
});

describe('Transformer 回写', () => {
  it('绕左上角旋转后，修正过的图层中心保持不动', () => {
    const before: LayerTransform = { x: 100, y: 80, scaleX: 1, scaleY: 1, rotation: 0 };
    const naive: LayerTransform = { ...before, rotation: 90 };
    const c0 = applyToPoint(compose(before), { x: SIZE.w / 2, y: SIZE.h / 2 });
    const cNaive = applyToPoint(compose(naive), { x: SIZE.w / 2, y: SIZE.h / 2 });
    assert.ok(!nearly(c0.x, cNaive.x), '不修正的话中心确实会跑（这条测试才有意义）');

    const fixed = centerPivot(before, SIZE, naive);
    const c1 = applyToPoint(compose(fixed), { x: SIZE.w / 2, y: SIZE.h / 2 });
    assert.ok(nearly(c1.x, c0.x) && nearly(c1.y, c0.y), `中心应回到 (${c0.x},${c0.y})，实际 (${c1.x},${c1.y})`);
    assert.ok(nearly(fixed.rotation, 90), '旋转角本身不该被修正掉');
  });

  it('旋转+缩放+平移同时发生时中心也不动', () => {
    const before: LayerTransform = { x: 220, y: 130, scaleX: 1.4, scaleY: 0.9, rotation: 18 };
    const after: LayerTransform = { x: 260, y: 90, scaleX: 2, scaleY: 1.1, rotation: -73 };
    const c0 = applyToPoint(compose(before), { x: SIZE.w / 2, y: SIZE.h / 2 });
    const fixed = centerPivot(before, SIZE, after);
    const c1 = applyToPoint(compose(fixed), { x: SIZE.w / 2, y: SIZE.h / 2 });
    assert.ok(nearly(c1.x, c0.x, 1e-9) && nearly(c1.y, c0.y, 1e-9));
    same(fixed, { ...after, x: fixed.x, y: fixed.y });
  });

  it('镜像手柄（scaleX 变负）也能走同一套回写', () => {
    const before: LayerTransform = { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 };
    const after: LayerTransform = { x: 50, y: 50, scaleX: -1, scaleY: 1, rotation: 0 };
    const fixed = centerPivot(before, SIZE, after);
    const c0 = applyToPoint(compose(before), { x: SIZE.w / 2, y: SIZE.h / 2 });
    const c1 = applyToPoint(compose(fixed), { x: SIZE.w / 2, y: SIZE.h / 2 });
    assert.ok(nearly(c1.x, c0.x) && nearly(c1.y, c0.y));
    // 绕水平中心镜像后，左半部分应换到右半：内容 (0,0) 的落点对称
    const left = applyToPoint(compose(fixed), { x: 0, y: 0 });
    assert.ok(left.x > c1.x, '镜像后原点应越过中心');
  });
});

describe('视口换算', () => {
  it('适配缩放时内容中心就在容器中心，且来回换算互逆', () => {
    const box = { w: 1200, h: 900 };
    const vp = { scale: 0.5, x: 0, y: 0 };
    const art = artMatrix(vp, box, SIZE);
    const center = contentToStage(art, { x: SIZE.w / 2, y: SIZE.h / 2 });
    assert.ok(nearly(center.x, box.w / 2) && nearly(center.y, box.h / 2));

    const pan = { scale: 1.75, x: -40, y: 22 };
    const art2 = artMatrix(pan, box, SIZE);
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 333, y: 121 }]) {
      const back = stageToContent(art2, contentToStage(art2, p));
      assert.ok(nearly(back.x, p.x, 1e-9) && nearly(back.y, p.y, 1e-9), '舞台↔内容应严格互逆');
    }
  });

  it('缩放后以光标为锚点：光标下的内容点不动', () => {
    const box = { w: 1000, h: 800 };
    const before = artMatrix({ scale: 0.5, x: 0, y: 0 }, box, SIZE);
    const pointer = { x: 620, y: 300 };
    const underCursor = stageToContent(before, pointer);
    // 放大到 0.8 后，反推让该内容点仍落在同一舞台坐标
    const scale = 0.8;
    const vp = {
      scale,
      x: pointer.x - underCursor.x * scale - (box.w - SIZE.w * scale) / 2,
      y: pointer.y - underCursor.y * scale - (box.h - SIZE.h * scale) / 2,
    };
    const after = contentToStage(artMatrix(vp, box, SIZE), underCursor);
    assert.ok(nearly(after.x, pointer.x, 1e-9) && nearly(after.y, pointer.y, 1e-9));
  });
});
