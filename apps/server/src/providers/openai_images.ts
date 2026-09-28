import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { config } from '../config';
import { fetchBinary, postJson } from './http';
import { UpstreamError, type ImageProvider } from './types';

/**
 * OpenAI 兼容端点（官方或中转站）的 gpt-image 系列 —— **只接文生图**。
 *
 * 为什么没有 edit / inpaint / upscale，这不是偷懒：gpt-image 的图生图走
 * `/images/edits` 的 multipart，且要求输入图与遮罩都正好是那三档标准尺寸、遮罩用**透明通道**
 * 标注重绘区。我们的遮罩是黑白不透明，消除类工具传的还是原图尺寸，服务端又刻意没有
 * 像素处理能力（见 deploy/Dockerfile 的"无原生依赖"）。缺一道转换就会变成"上游 400、
 * 用户看到 PROVIDER_FAILED"，所以按 availableCapabilities 的口径只声明真做得到的一项。
 *
 * 2026-09-28 拿中转站真 key 实测过（4 个 gpt-image 模型可选）：
 *   - 文生图 200 通，1024x1024 一张 **26.9s**；回的是 `data[].url` 而不是 b64_json，
 *     所以"把字节拉下来"那条分支才是主路。`TASK_TIMEOUT_MS`（默认 120s）是这里真正的天花板。
 *   - **不回 `usage`** —— 成本自算不了，`OPENAI_IMAGES_PRICE_YUAN` 就是照你实际账单填的估值。
 *   - **`quality` 被静默忽略**：乱填一个值照样 200 出图。官方端点认它，所以参数留着，
 *     但别指望在中转站身上调出差别。
 *   - `/images/edits` 有路由（缺参数时 400 提示 `images[].image_url is required`，
 *     字段名与官方 multipart 那套不一样），但塞 dataURL 进去 **502**（回的是 CDN 错误页）。
 *     要接编辑，先得有上游拉得到的公网图片 URL —— 也就是把签名外链那件事一起做回来。
 */

/** gpt-image 只认这三档输出尺寸，非标准比例按比例就近吸附 */
const SIZES: { label: string; w: number; h: number }[] = [
  { label: '1024x1024', w: 1024, h: 1024 },
  { label: '1536x1024', w: 1536, h: 1024 },
  { label: '1024x1536', w: 1024, h: 1536 },
];

export function snapSize(width: number, height: number): { label: string; width: number; height: number } {
  // 用对数距离比较比例：拿绝对差值比会让 16:9 和 4:3 抢同一档时偏袒小比例
  const want = Math.log(width / height);
  let best = SIZES[0];
  for (const s of SIZES) {
    if (Math.abs(Math.log(s.w / s.h) - want) < Math.abs(Math.log(best.w / best.h) - want)) best = s;
  }
  return { label: best.label, width: best.w, height: best.h };
}

interface ImagesResponse {
  data?: { url?: string; b64_json?: string; revised_prompt?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { message?: string; code?: string; type?: string };
}

export const openaiImagesProvider: ImageProvider = {
  id: 'openai_images',
  label: 'OpenAI 兼容（gpt-image）',
  capabilities: ['text2image'],
  get available() {
    return Boolean(config.OPENAI_IMAGES_API_KEY);
  },
  priceFor: (_cap: Capability) => config.OPENAI_IMAGES_PRICE_YUAN,

  async generate(req: ProviderRequest, onProgress, opts): Promise<ProviderResult> {
    const size = snapSize(req.size?.width ?? 1024, req.size?.height ?? 1024);
    // 没有 negative_prompt 这一参数：上游只吃 prompt 一段文字
    const body = {
      model: config.OPENAI_IMAGES_MODEL,
      prompt: req.prompt ?? '',
      n: req.count ?? 1,
      size: size.label,
      quality: config.OPENAI_IMAGES_QUALITY,
    };

    onProgress?.(0.12);
    const json = await postJson<ImagesResponse>(
      `${config.OPENAI_IMAGES_BASE_URL.replace(/\/$/, '')}/images/generations`,
      body,
      { authorization: `Bearer ${config.OPENAI_IMAGES_API_KEY}` },
      180_000,
      opts?.signal,
    );
    onProgress?.(0.9);

    if (json.error?.message) throw new UpstreamError('bad_response', `gpt-image：${json.error.message}`, undefined, json.error);
    const items = json.data ?? [];
    if (!items.length) throw new UpstreamError('bad_response', 'gpt-image 未返回图片');

    const images = await Promise.all(
      items.map(async (it) => {
        // gpt-image 官方恒为 b64_json；部分中转站仍回 URL，两种都接下来
        if (it.b64_json) return { base64: `data:image/png;base64,${it.b64_json}`, mime: 'image/png' };
        if (it.url) return await fetchBinary(it.url, undefined, opts?.signal);
        throw new UpstreamError('bad_response', 'gpt-image 返回项里没有图片数据');
      }),
    );

    return {
      images,
      // 上游按 token 计费，这里用配置的"元/张"估：熔断要的是量级对得上，
      // 不是逐笔对账。quality 从 auto 改高就相应调高 OPENAI_IMAGES_PRICE_YUAN。
      costYuan: images.length * config.OPENAI_IMAGES_PRICE_YUAN,
      provider: 'openai_images',
      model: config.OPENAI_IMAGES_MODEL,
      raw: json.usage,
    };
  },
};
