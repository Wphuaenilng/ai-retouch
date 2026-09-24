import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { config } from '../config';
import { fetchBinary, postJson } from './http';
import { UpstreamError, type ImageProvider } from './types';

/**
 * 火山方舟 · 豆包 Seedream 图像生成/编辑。
 *
 * ⚠️ 未用真实 key 验证过：请求体字段名（image / mask_image / max_images /
 * sequential_image_generation）与模型 ID 请以官方文档为准，本文件是唯一改动点。
 * 业务层只依赖 ProviderRequest/ProviderResult，字段对不上时只改这里。
 */
const PRICES: Partial<Record<Capability, number>> = {
  text2image: 0.2,
  edit: 0.26,
  inpaint: 0.26,
  outpaint: 0.26,
  upscale: 0.12,
};

/** 单价的唯一出口：报价与记账都走这里，避免两处数字各改各的 */
const priceFor = (c: Capability): number => PRICES[c] ?? 0.26;

interface ArkResponse {
  data?: { url?: string; b64_json?: string; size?: string; watermark?: boolean }[];
  usage?: { generated_images?: number; total_tokens?: number };
  error?: { message?: string; code?: string };
}

export const seedreamProvider: ImageProvider = {
  id: 'seedream',
  label: '火山方舟 Seedream',
  capabilities: ['text2image', 'edit', 'inpaint', 'outpaint', 'upscale'],
  get available() {
    return Boolean(config.ARK_API_KEY);
  },
  priceFor,

  async generate(req: ProviderRequest, onProgress, opts): Promise<ProviderResult> {
    const w = Math.min(req.size?.width ?? 1024, 4096);
    const h = Math.min(req.size?.height ?? 1024, 4096);
    const body: Record<string, unknown> = {
      model: config.ARK_IMAGE_MODEL,
      prompt: req.prompt ?? '',
      size: `${w}x${h}`,
      response_format: 'b64_json',
      watermark: false,
    };
    if (req.images.length) body.image = req.images.map((i) => i.base64 ?? i.url).filter(Boolean);
    if (req.mask) body.mask_image = req.mask.base64 ?? req.mask.url;
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.count && req.count > 1) body.max_images = req.count;

    onProgress?.(0.12);
    const json = await postJson<ArkResponse>(
      `${config.ARK_BASE_URL.replace(/\/$/, '')}/images/generations`,
      body,
      { authorization: `Bearer ${config.ARK_API_KEY}` },
      120_000,
      opts?.signal,
    );
    onProgress?.(0.9);

    if (json.error?.message) throw new UpstreamError('bad_response', `Seedream：${json.error.message}`);
    const items = json.data ?? [];
    if (!items.length) throw new UpstreamError('bad_response', 'Seedream 未返回图片');

    const images = await Promise.all(
      items.map(async (it) => {
        if (it.b64_json) return { base64: `data:image/png;base64,${it.b64_json}`, mime: 'image/png' };
        if (it.url) return await fetchBinary(it.url, undefined, opts?.signal);
        throw new UpstreamError('bad_response', 'Seedream 返回项里没有图片数据');
      }),
    );

    return {
      images,
      costYuan: images.length * priceFor(req.capability),
      provider: 'seedream',
      model: config.ARK_IMAGE_MODEL,
      raw: json.usage,
    };
  },
};
