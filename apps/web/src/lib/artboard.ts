/**
 * 画布几何：图层变换矩阵与 Konva Transformer 的回写换算。
 * 单独成文件是为了能在 node 里跑单测（02 §M3 的"常见坑"就是这么要求的）——
 * 变换在自定义视口下算错一格，手柄就漂移、图层就飞走，而这在眼里只是"手感问题"，
 * 把数学抽出来才能证伪。
 *
 * 矩阵约定同 Konva.Matrix：[a,b,c,d,e,f]，点变换为
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * 合成顺序 translate → rotate → scale（与 Konva 一致）。
 */

export type Mat = [number, number, number, number, number, number];

export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** 角度制 */
  rotation: number;
}

export interface Size {
  w: number;
  h: number;
}

const DEG = Math.PI / 180;

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function compose(t: LayerTransform): Mat {
  const r = t.rotation * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * t.scaleX, s * t.scaleX, -s * t.scaleY, c * t.scaleY, t.x, t.y];
}

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return IDENTITY;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function applyToPoint(m: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/**
 * 拆回 旋转 + 各向缩放 + 平移（画布不需要斜切）。
 * 镜像时行列式为负：先把第一列翻回来算角度，再让 scaleX 带符号，
 * 这样 compose(decompose(m)) 才能等于 m —— 否则镜像层会被读成"转了 180°"。
 */
export function decompose(m: Mat): LayerTransform {
  const det = m[0] * m[3] - m[1] * m[2];
  const [ax, ay] = det < 0 ? [-m[0], -m[1]] : [m[0], m[1]];
  const rotation = Math.atan2(ay, ax) / DEG;
  const scaleX = (det < 0 ? -1 : 1) * Math.hypot(m[0], m[1]);
  const scaleY = Math.hypot(m[2], m[3]);
  return { x: m[4], y: m[5], scaleX, scaleY, rotation };
}

/**
 * Konva 的 rotation 绕节点原点（图片左上角）转，直接写回会让图层"飞走"。
 * Transformer 结束后按"变换前后中心不动"反推 x/y。
 */
export function centerPivot(before: LayerTransform, size: Size, after: LayerTransform): LayerTransform {
  const c0 = applyToPoint(compose(before), { x: size.w / 2, y: size.h / 2 });
  const c1 = applyToPoint(compose(after), { x: size.w / 2, y: size.h / 2 });
  return { ...after, x: after.x + (c0.x - c1.x), y: after.y + (c0.y - c1.y) };
}

/** 视口 Group 的矩阵（内容坐标 → 舞台坐标） */
export function artMatrix(viewport: { scale: number; x: number; y: number }, box: Size, content: Size): Mat {
  return compose({
    x: (box.w - content.w * viewport.scale) / 2 + viewport.x,
    y: (box.h - content.h * viewport.scale) / 2 + viewport.y,
    scaleX: viewport.scale,
    scaleY: viewport.scale,
    rotation: 0,
  });
}

/** 舞台坐标 → 内容坐标（图片像素空间）。框选、笔刷落点、以后放 SVG 叠层都走这一步 */
export function stageToContent(art: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return applyToPoint(invert(art), p);
}

/** 内容坐标 → 舞台坐标 */
export function contentToStage(art: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return applyToPoint(art, p);
}

/** 相对误差容动的相等比较（矩阵运算都是浮点） */
export function nearly(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}
