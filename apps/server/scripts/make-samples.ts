/**
 * 生成三张内置**测试图**（首屏"不传自己的图也能玩一遍"用）。
 *
 * 刻意不假装是照片：合成照片只会得到"看着像警示图标"的东西（试过，见 05 的这条任务记录）。
 * 反过来，标准测试图在这件事上更好用：边缘是锐利的、色阶是已知的，
 * "工具到底改没改这张图"一眼可判；接真 key 之后它们还是**确定的复现输入**。
 *
 * 重跑：pnpm --filter @retouch/server samples
 * 产物入库且逐字节稳定（同一份代码跑两次 diff 为空）—— 用它做回归输入时这条很重要。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rgba } from '../src/lib/png';

type RGB = [number, number, number, number];
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'samples');
const clamp8 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** 确定性伪随机：没有随机源就不该有不可复现的字节 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), a[3]];

function hsv(h: number, s: number, v: number, a = 255): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  // 扇区表必须按标准顺序：写错一格，色相条就会在 1/3、2/3 处硬跳变（第一版就错在这）
  const [r, g, b] = (
    [
      [v, t, p],
      [q, v, p],
      [p, v, t],
      [p, q, v],
      [t, p, v],
      [v, p, q],
    ] as const
  )[((i % 6) + 6) % 6];
  return [clamp8(r * 255), clamp8(g * 255), clamp8(b * 255), a];
}

function disc(c: Rgba, cx: number, cy: number, r: number, color: RGB): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1)
    for (let x = Math.floor(cx - r); x <= cx + r; x += 1) if (Math.hypot(x - cx, y - cy) <= r) c.set(x, y, color);
}

function ring(c: Rgba, cx: number, cy: number, r: number, hole: number, color: RGB): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1)
    for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && d > hole) c.set(x, y, color);
    }
}

function ellipse(c: Rgba, cx: number, cy: number, rx: number, ry: number, color: RGB): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y += 1)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) c.set(x, y, color);
    }
}

/** 接触阴影：一圈圈往外淡出，比一个实心椭圆更像"物体压在地上" */
function contactShadow(c: Rgba, cx: number, cy: number, rx: number, ry: number): void {
  for (let k = 6; k >= 1; k -= 1) {
    const a = Math.round(26 + (6 - k) * 9);
    ellipse(c, cx, cy, rx + k * 5, ry + k * 2.2, [12, 12, 14, a]);
  }
}

function roundRect(c: Rgba, x: number, y: number, w: number, h: number, r: number, color: RGB): void {
  for (let j = y; j < y + h; j += 1)
    for (let i = x; i < x + w; i += 1) {
      const dx = Math.max(x + r - i, 0, i - (x + w - 1 - r));
      const dy = Math.max(y + r - j, 0, j - (y + h - 1 - r));
      if (Math.hypot(dx, dy) <= r) c.set(i, j, color);
    }
}

/** 直角三角形（斜边是抠图最容易露馅的地方，所以单独要一张） */
function triangle(c: Rgba, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: RGB): void {
  const inTri = (px: number, py: number): boolean => {
    const s = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d1 = s(x0, y0, x1, y1, px, py);
    const d2 = s(x1, y1, x2, y2, px, py);
    const d3 = s(x2, y2, x0, y0, px, py);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  const xa = Math.min(x0, x1, x2);
  const xb = Math.max(x0, x1, x2);
  const ya = Math.min(y0, y1, y2);
  const yb = Math.max(y0, y1, y2);
  for (let y = ya; y <= yb; y += 1) for (let x = xa; x <= xb; x += 1) if (inTri(x, y)) c.set(x, y, color);
}

function grain(c: Rgba, n: number, seed: number, amp: number): void {
  const r = rng(seed);
  for (let k = 0; k < n; k += 1) {
    const x = Math.floor(r() * c.w);
    const y = Math.floor(r() * c.h);
    const d = (r() * 2 - 1) * amp;
    const i = (y * c.w + x) * 4;
    c.data[i] = clamp8(c.data[i] + d);
    c.data[i + 1] = clamp8(c.data[i + 1] + d);
    c.data[i + 2] = clamp8(c.data[i + 2] + d);
  }
}

/**
 * 1) edges —— 边缘 / 半透明 / 细结构靶子。抠图、换背景、去阴影看这张。
 * 背景刻意用中灰而不是白：主体与背景同色系时抠图失败才看得出来。
 */
function edges(): Buffer {
  const W = 800;
  const H = 600;
  const c = new Rgba(W, H, [150, 152, 156, 255]);
  // 右半边换一档亮度：主体跨边界时，靠"背景突变"就能看出掩膜有没有跟住
  for (let y = 0; y < H; y += 1) c.fillRect(W / 2, y, W / 2, 1, [112, 114, 118, 255]);
  const ground = H * 0.78;

  const dark: RGB = [34, 36, 40, 255];
  const warm: RGB = [206, 128, 62, 255];
  const cool: RGB = [64, 118, 156, 255];

  contactShadow(c, W * 0.18, ground, 62, 12);
  disc(c, W * 0.18, ground - 74, 66, dark); // 实心圆盘：最理想的硬边

  contactShadow(c, W * 0.38, ground, 60, 12);
  ring(c, W * 0.38, ground - 78, 66, 26, warm); // 带孔：掩膜必须知道洞里不算主体

  contactShadow(c, W * 0.58, ground, 74, 12);
  roundRect(c, W * 0.58 - 70, ground - 150, 140, 150, 22, cool); // 圆角矩形：曲率连续变化

  contactShadow(c, W * 0.8, ground, 78, 12);
  triangle(c, W * 0.8 - 74, ground, W * 0.8 + 74, ground, W * 0.8, ground - 158, dark); // 斜边 + 尖角

  // 两根细条：抠图最爱把 2px 结构整根吃掉
  c.fillRect(W * 0.3, ground - 190, 3, 96, dark);
  c.fillRect(W * 0.66, ground - 210, 2, 118, warm);
  return c.toPng();
}

/**
 * 2) ramp —— 色阶 / 饱和度 / 解析力靶子。调色、超分放大看这张。
 * 每格都是已知值，所以"改了多少"能读出来，而不是"看起来不一样"。
 */
function ramp(): Buffer {
  const W = 800;
  const H = 600;
  // 底色刻意用近黑：灰阶条里有 v=128 那一格，用中灰当底就会"凭空少一格"
  const c = new Rgba(W, H, [22, 23, 26, 255]);
  const band = 92;
  const gap = 26;
  let y = 24;

  // 11 级灰阶（0→255）：亮度/对比改动的直读尺
  for (let k = 0; k < 11; k += 1) {
    const v = Math.round((k / 10) * 255);
    c.fillRect(Math.round((k * W) / 11), y, Math.ceil(W / 11), band, [v, v, v, 255]);
  }
  y += band + gap;

  // 饱和度楔形（固定色相 0.08 橙）：饱和滑杆的直读尺
  for (let x = 0; x < W; x += 1) c.fillRect(x, y, 1, band, hsv(0.08, x / (W - 1), 0.92));
  y += band + gap;

  // 色相环展开：色温滑杆会整体推这条，一眼看得出偏了多少
  for (let x = 0; x < W; x += 1) c.fillRect(x, y, 1, band, hsv(x / (W - 1), 0.85, 0.95));
  y += band + gap;

  // 线对组：频率必须**由粗到细**，这样"从哪一格开始糊成一团"才是可读数
  const rest = H - y - 24;
  let x = 0;
  let pitch = 22;
  while (x < W) {
    const w = Math.max(1, Math.round(pitch));
    const until = Math.min(W, x + w * 8);
    for (let i = x; i < until; i += 1) {
      const on = Math.floor((i - x) / w) % 2 === 0;
      for (let j = y; j < y + rest; j += 1) c.set(i, j, on ? [16, 16, 18, 255] : [240, 240, 238, 255]);
    }
    x = until;
    pitch *= 0.62;
  }
  grain(c, 6000, 5, 4); // 极轻颗粒：给"降噪"留一点活干
  return c.toPng();
}

/**
 * 3) marks —— 可去除物靶子。消除/去水印、消除文字、去杂物看这张。
 * 底图是一个简单场景，上面压了角标、斜排水印、假文字块与灰尘点。
 */
function marks(): Buffer {
  const W = 800;
  const H = 600;
  const c = new Rgba(W, H);
  for (let y2 = 0; y2 < H; y2 += 1)
    c.fillRect(0, y2, W, 1, mix([hsv(0.58, 0.34, 0.72)][0], [214, 178, 128, 255], (y2 / (H - 1)) ** 1.25));
  disc(c, W * 0.72, H * 0.24, 44, [246, 232, 190, 255]);
  c.fillRect(0, H * 0.7, W, H * 0.3, [74, 84, 66, 255]);
  roundRect(c, W * 0.12, H * 0.42, 150, 168, 10, [96, 74, 58, 255]);
  triangle(c, W * 0.12 - 14, H * 0.42, W * 0.12 + 164, H * 0.42, W * 0.12 + 75, H * 0.42 - 74, [64, 48, 38, 255]);
  c.fillRect(W * 0.12 + 40, H * 0.56, 62, 54, [196, 206, 214, 255]);

  // 角标：半透明白色块 + 内嵌深色条，去水印的典型形状
  c.fillRect(W - 168, H - 74, 152, 54, [255, 255, 255, 120]);
  c.fillRect(W - 156, H - 62, 96, 12, [40, 40, 44, 200]);
  c.fillRect(W - 156, H - 44, 62, 8, [40, 40, 44, 150]);

  // 斜排水印：一条贯穿画面的半透明带，最难缠的一种
  for (let t = 0; t < 1; t += 0.002) {
    const x = Math.round(lerp(-40, W + 40, t));
    const yb = Math.round(lerp(H * 0.86, H * 0.14, t));
    for (let k = -7; k <= 7; k += 1) c.set(x, yb + k, [255, 255, 255, 78]);
  }

  // "文字块"：三行长短不一的小条，消除文字的预期输入
  for (let line = 0; line < 3; line += 1) {
    const widths = [176, 142, 200];
    c.fillRect(W * 0.44, H * 0.3 + line * 26, widths[line], 11, [28, 28, 32, 210]);
  }

  const r = rng(97);
  for (let k = 0; k < 90; k += 1) disc(c, r() * W, r() * H, 1 + r() * 2.4, [250, 248, 244, Math.round(150 + r() * 90)]); // 灰尘点
  for (let k = 0; k < 5; k += 1) {
    const x = Math.floor(r() * W);
    const y0 = Math.floor(r() * H * 0.5);
    for (let y2 = y0; y2 < y0 + 60 + r() * 160; y2 += 1) c.set(x + Math.round((y2 - y0) * 0.06), y2, [252, 250, 246, 150]); // 细划痕
  }
  grain(c, 9000, 13, 8);
  return c.toPng();
}

const SAMPLES: Array<[string, () => Buffer]> = [
  ['edges', edges],
  ['ramp', ramp],
  ['marks', marks],
];

mkdirSync(OUT, { recursive: true });
for (const [name, make] of SAMPLES) {
  const buf = make();
  writeFileSync(join(OUT, `${name}.png`), buf);
  console.log(`${name}.png  ${(buf.length / 1024).toFixed(1)}KB`);
}
