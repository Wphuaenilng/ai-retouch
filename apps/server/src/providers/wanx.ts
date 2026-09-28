import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { config } from '../config';
import { fetchBinary, postJson } from './http';
import { UpstreamError, type ImageProvider } from './types';

/**
 * 阿里云百炼 · 通义万相 2.6（**同步**多模态端点，不是老的"提交任务 + 轮询"那一套）。
 *
 * 2026-09-28 用真 key 实测过：
 *   - `dashscope.aliyuncs.com/api/v1` 直接可用，不必换成 workspace 专属域名；
 *   - 文生图与整图编辑都是**一发请求直接回图**，`X-DashScope-Async` 与 `/tasks/{id}` 轮询都不需要；
 *   - `parameters.size` 给任意 `W*H` 都收，上游就近吸附（请求 1500*2000 → 实得 1488*2000），
 *     所以结果尺寸只能按落盘字节算，不能拿请求里那一对；
 *   - content 数组只认 `text` / `image`，塞 `mask` 会被拒（"Either 'text' or 'image' must be provided"）
 *     —— 局部重绘在这一版协议里没有，所以本文件**不声明 inpaint**。超分、抠图同理：那是别的模型，
 *     我们没接也没验过。声明了就会有人选到，然后在上游撞死。
 *
 * 输入图支持 dataURL（我们的 `toProviderRef` 给的就是 `data:image/png;base64,...`），
 * 上限 10MB、边长 240~8000，PNG 不能带透明。
 */
const GEN_PATH = '/services/aigc/multimodal-generation/generation';

const PRICES: Partial<Record<Capability, number>> = {
  text2image: 0.2,
  edit: 0.26,
};

/** 单价的唯一出口：报价与记账都走这里 */
const priceFor = (c: Capability): number => PRICES[c] ?? 0.26;

interface DashContent {
  type?: string;
  text?: string;
  image?: string;
}
interface DashResponse {
  output?: {
    finished?: boolean;
    code?: string;
    message?: string;
    choices?: { finish_reason?: string; message?: { content?: DashContent[] } }[];
  };
  usage?: { image_count?: number; size?: string };
  code?: string;
  message?: string;
}

export const wanxProvider: ImageProvider = {
  id: 'wanx',
  label: '阿里云百炼 通义万相',
  capabilities: ['text2image', 'edit'],
  get available() {
    return Boolean(config.DASHSCOPE_API_KEY);
  },
  priceFor,

  async generate(req: ProviderRequest, onProgress, opts): Promise<ProviderResult> {
    const base = config.DASHSCOPE_BASE_URL.replace(/\/$/, '');
    const isT2i = req.capability === 'text2image';
    const w = Math.min(req.size?.width ?? 1024, 2048);
    const h = Math.min(req.size?.height ?? 1024, 2048);

    const content: Record<string, unknown>[] = [{ text: req.prompt ?? '' }];
    for (const img of req.images) {
      const ref = img.base64 ?? img.url;
      if (ref) content.push({ image: ref });
    }

    const body = {
      model: isT2i ? config.WANX_T2I_MODEL : config.WANX_EDIT_MODEL,
      input: { messages: [{ role: 'user', content }] },
      parameters: {
        size: `${w}*${h}`,
        n: req.count ?? 1,
        watermark: false,
        // 编辑模式：false=出整图，true=图文混排。我们只要整图
        ...(isT2i ? {} : { enable_interleave: false }),
      },
    };

    onProgress?.(0.1);
    const json = await postJson<DashResponse>(
      `${base}${GEN_PATH}`,
      body,
      { authorization: `Bearer ${config.DASHSCOPE_API_KEY}`, 'content-type': 'application/json' },
      120_000,
      opts?.signal,
    );
    onProgress?.(0.9);

    if (json.code) throw new UpstreamError('bad_response', `万相：${json.message ?? json.code}`);
    const items = (json.output?.choices ?? []).flatMap((c) => c.message?.content ?? []);
    const urls = items.map((i) => i.image).filter((u): u is string => Boolean(u));
    if (!urls.length) {
      const why = json.output?.message ?? json.output?.code ?? items.find((i) => i.text)?.text ?? '没有图片';
      throw new UpstreamError('bad_response', `万相未返回图片：${why}`);
    }

    const images = await Promise.all(
      urls.map(async (u) =>
        u.startsWith('data:') ? { base64: u, mime: 'image/png' } : await fetchBinary(u, undefined, opts?.signal),
      ),
    );

    return {
      images,
      costYuan: images.length * priceFor(req.capability),
      provider: 'wanx',
      model: isT2i ? config.WANX_T2I_MODEL : config.WANX_EDIT_MODEL,
      raw: json.usage,
    };
  },
};
