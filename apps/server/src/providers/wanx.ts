import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { config } from '../config';
import { fetchBinary, getJson, poll, postJson } from './http';
import { UpstreamError, type ImageProvider } from './types';

/**
 * 阿里云百炼 · 通义万相（异步任务式：提交 → 轮询）。
 *
 * ⚠️ 未用真实 key 验证过：wan2.6 的编辑端点、input/parameters 字段名、
 * 是否接受 dataURL 都需按官方文档核对（搜"万相-图像生成与编辑2.6 API参考"）。
 * 若上游只收公网 URL，把 USE_SIGNED_URL 打开，我们会下发签名外链。
 */
const T2I_PATH = '/services/aigc/text2image/image-synthesis';
const EDIT_PATH = '/services/aigc/image2image/image-synthesis';
const USE_SIGNED_URL = true;

const PRICES: Partial<Record<Capability, number>> = {
  text2image: 0.2,
  edit: 0.26,
  inpaint: 0.26,
  outpaint: 0.26,
  upscale: 0.12,
  segment: 0.03,
};

interface DashSubmit {
  output?: { task_id?: string; task_status?: string };
  code?: string;
  message?: string;
}
interface DashPoll {
  output?: {
    task_status?: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
    code?: string;
    message?: string;
    results?: { url?: string; image_url?: string; code?: string; message?: string }[];
  };
  usage?: { image_count?: number };
}

const ref = (r: { url?: string; base64?: string }): string | undefined =>
  USE_SIGNED_URL && r.url ? r.url : r.base64 ?? r.url;

export const wanxProvider: ImageProvider = {
  id: 'wanx',
  label: '阿里云百炼 通义万相',
  capabilities: ['text2image', 'edit', 'inpaint', 'outpaint', 'upscale', 'segment'],
  get available() {
    return Boolean(config.DASHSCOPE_API_KEY);
  },
  priceFor: (c) => PRICES[c] ?? 0.26,

  async generate(req: ProviderRequest, onProgress): Promise<ProviderResult> {
    const base = config.DASHSCOPE_BASE_URL.replace(/\/$/, '');
    const isT2i = req.capability === 'text2image';
    const w = Math.min(req.size?.width ?? 1024, 2048);
    const h = Math.min(req.size?.height ?? 1024, 2048);

    const body: Record<string, unknown> = isT2i
      ? {
          model: config.WANX_T2I_MODEL,
          input: { prompt: req.prompt ?? '', negative_prompt: req.negativePrompt },
          parameters: { size: `${w}*${h}`, n: req.count ?? 1 },
        }
      : {
          model: config.WANX_EDIT_MODEL,
          input: {
            prompt: req.prompt ?? '',
            images: req.images.map((i) => ref(i)).filter(Boolean),
            ...(req.mask ? { mask_image_url: ref(req.mask) } : {}),
          },
          parameters: { size: `${w}*${h}`, n: req.count ?? 1 },
        };

    const headers = {
      authorization: `Bearer ${config.DASHSCOPE_API_KEY}`,
      'X-DashScope-Async': 'enable',
      'content-type': 'application/json',
    };

    onProgress?.(0.08);
    const submitted = await postJson<DashSubmit>(`${base}${isT2i ? T2I_PATH : EDIT_PATH}`, body, headers, 60_000);
    if (submitted.code) throw new UpstreamError('bad_response', `万相：${submitted.message ?? submitted.code}`);
    const taskId = submitted.output?.task_id;
    if (!taskId) throw new UpstreamError('bad_response', '万相未返回 task_id');

    const done = await poll<DashPoll>(
      async () => {
        const j = await getJson<DashPoll>(`${base}/tasks/${taskId}`, { authorization: headers.authorization }, 30_000);
        const st = j.output?.task_status;
        if (st === 'SUCCEEDED') return { done: true, value: j };
        if (st === 'FAILED' || st === 'CANCELED') {
          return { done: true, failed: `万相任务${st}：${j.output?.message ?? j.output?.code ?? '未知原因'}` };
        }
        return { done: false };
      },
      { intervalMs: 1500, timeoutMs: config.TASK_TIMEOUT_MS, onProgress: (e) => onProgress?.(0.1 + e * 0.8) },
    );

    const results = done.output?.results ?? [];
    if (!results.length) throw new UpstreamError('bad_response', '万相未返回结果图');
    const images = await Promise.all(
      results.map(async (r) => {
        const url = r.url ?? r.image_url;
        if (!url) throw new UpstreamError('bad_response', `万相结果缺 URL：${r.message ?? r.code ?? ''}`);
        return url.startsWith('data:') ? { base64: url, mime: 'image/png' } : await fetchBinary(url);
      }),
    );
    onProgress?.(0.95);

    return {
      images,
      costYuan: images.length * (PRICES[req.capability] ?? 0.26),
      provider: 'wanx',
      model: isT2i ? config.WANX_T2I_MODEL : config.WANX_EDIT_MODEL,
      raw: done.usage,
    };
  },
};
