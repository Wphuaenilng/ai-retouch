import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config';
import { err } from '../lib/errors';
import { saveImage } from './images';
import type { ImageRow } from '../store/images';

const DIR = join(ROOT, 'apps/server/assets/samples');

/**
 * 三张内置测试图。刻意**不假装是照片** —— 合成照片只会得到"看着像警示图标"的东西；
 * 而测试图的优势正好相反：边缘锐利、色阶已知，"工具改没改这张图"能读出来，
 * 接真 key 之后它们还是逐字节稳定的复现输入（见 scripts/make-samples.ts）。
 */
export interface SampleMeta {
  id: string;
  label: string;
  note: string;
}

const SAMPLES: SampleMeta[] = [
  { id: 'edges', label: '边缘', note: '硬边 / 圆角 / 斜边 / 带孔 / 细条 —— 抠图、换背景看它' },
  { id: 'ramp', label: '色阶', note: '灰阶 / 饱和 / 色相 / 由粗到细的线对 —— 调色、超分看它' },
  { id: 'marks', label: '杂物', note: '斜排水印 / 角标 / 文字块 / 灰尘划痕 —— 消除类看它' },
];

export function listSamples(): SampleMeta[] {
  return SAMPLES;
}

/** id 只认白名单：绝不把外部字符串拼进路径 */
function meta(id: string): SampleMeta {
  const m = SAMPLES.find((s) => s.id === id);
  if (!m) throw err('NOT_FOUND', `没有这张测试图：${id}`);
  return m;
}

export function readSample(id: string): Buffer {
  meta(id);
  try {
    return readFileSync(join(DIR, `${id}.png`));
  } catch {
    throw err('NOT_FOUND', `测试图文件缺失：${id}.png（跑 pnpm --filter @retouch/server samples 重新生成）`);
  }
}

/**
 * 导入 = 把这张图作为该用户的 original 落一份。
 * 走的是和上传完全同一条 saveImage（类型/像素上限/落盘/建行都一样），
 * 所以导入之后它就和普通图片没有任何区别 —— 包括被删除、被引用、算配额。
 * 唯一不同是不用再过内容审核：这是我们仓库里的文件，不是用户内容。
 */
export async function importSample(id: string, userId: string): Promise<ImageRow> {
  const buf = readSample(id);
  return saveImage({ userId, kind: 'original', buf });
}
