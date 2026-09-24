import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { createHash } from 'node:crypto';
import { Rgba } from '../lib/png';
import { sleep } from './http';
import type { ImageProvider } from './types';

const ALL: Capability[] = ['text2image', 'edit', 'inpaint', 'outpaint', 'upscale', 'segment', 'portrait', 'textRender'];

const CAP_LABEL: Record<Capability, string> = {
  text2image: 'T2I',
  edit: 'EDIT',
  inpaint: 'MASK',
  outpaint: 'OUTP',
  upscale: 'X2UP',
  segment: 'CUT',
  portrait: 'FACE',
  textRender: 'TEXT',
};

function palette(seedText: string): [number, number, number][] {
  const h = createHash('sha256').update(seedText).digest();
  // 银盐灰 + 低饱和主色，避免占位图太"AI 默认紫"
  const base: [number, number, number] = [40 + (h[0] % 60), 42 + (h[1] % 60), 46 + (h[2] % 60)];
  const accent: [number, number, number] = [90 + (h[3] % 120), 80 + (h[4] % 110), 70 + (h[5] % 110)];
  const accent2: [number, number, number] = [60 + (h[6] % 90), 70 + (h[7] % 90), 90 + (h[8] % 110)];
  return [base, accent, accent2];
}

/**
 * Mock Provider —— 不需要任何 key，产出真实 PNG 字节。
 * 存在的意义：断网/未开通模型时，上传→排队→进度→SSE→落库→画布这条链路照样能跑，
 * 前端与 Agent 的开发不被上游阻塞。
 */
export const mockProvider: ImageProvider = {
  id: 'mock',
  label: 'Mock 占位图',
  capabilities: ALL,
  available: true,
  priceFor: () => 0,
  async generate(req: ProviderRequest, onProgress): Promise<ProviderResult> {
    const w = Math.min(req.size?.width ?? 1024, 2048);
    const h = Math.min(req.size?.height ?? 1024, 2048);
    const count = req.capability === 'text2image' ? (req.count ?? 1) : 1;

    onProgress?.(0.18);
    await sleep(320);
    onProgress?.(0.55);
    await sleep(380);
    onProgress?.(0.85);

    const images = Array.from({ length: count }, (_, i) => {
      const [base, accent, accent2] = palette(`${req.capability}|${req.prompt ?? ''}|${i}`);
      const c = new Rgba(w, h, [base[0], base[1], base[2], 255]);
      const band = Math.round(h / 3);
      for (let y = 0; y < h; y += 1) {
        const t = y / h;
        const col: [number, number, number, number] = [
          Math.round(base[0] * (1 - t) + accent2[0] * t),
          Math.round(base[1] * (1 - t) + accent2[1] * t),
          Math.round(base[2] * (1 - t) + accent2[2] * t),
          255,
        ];
        c.fillRect(0, y, w, 1, col);
      }
      c.fillRect(Math.round(w * 0.12), band, Math.round(w * 0.5), band, [accent[0], accent[1], accent[2], 255]);
      c.fillRect(Math.round(w * 0.66), Math.round(band * 0.6), Math.round(w * 0.2), Math.round(h * 0.72), [
        accent2[0],
        accent2[1],
        accent2[2],
        235,
      ]);
      // 边缘棋盘格：一眼能看出这是占位图，不会误认成模型效果
      const cell = Math.max(8, Math.round(w / 32));
      for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
        if (x < cell * 2 || y < cell * 2 || x > w - cell * 3 || y > h - cell * 3) {
          if (((x / cell + y / cell) | 0) % 2 === 0) c.fillRect(x, y, cell, cell, [233, 233, 229, 255]);
        }
      }
      if (req.mask) {
        c.fillRect(Math.round(w * 0.25), Math.round(h * 0.25), Math.round(w * 0.5), Math.round(h * 0.5), [
          200, 80, 60, 90,
        ]);
      }
      const scale = Math.max(2, Math.round(w / 220));
      c.text(cell * 3, cell * 3, CAP_LABEL[req.capability], [233, 233, 229, 255], scale);
      c.text(cell * 3, h - cell * 3 - 35, `#0${i + 1}`.slice(-2), [233, 233, 229, 255], scale);
      const buf = c.toPng();
      return { base64: `data:image/png;base64,${buf.toString('base64')}`, mime: 'image/png', width: w, height: h };
    });

    await sleep(120);
    return { images, costYuan: 0, provider: 'mock', model: 'mock-placeholder', raw: { prompt: req.prompt } };
  },
};
