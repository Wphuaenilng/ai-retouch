import { config } from '../config';
import { err } from '../lib/errors';
import type { ImageRow } from '../store/images';
import { loadBuffer } from './images';

/**
 * 内容安全。默认 none（小范围邀请制），生产分享前建议开 qwen-vl：
 * 用多模态模型对上传图与生成图做一次粗筛。
 * 阿里云内容安全（Green）更合规，接入点在下方 switch 里留好了。
 */
const BLOCKED_PROMPT_WORDS = ['未成年', '儿童色情', '色情', '裸露', '血腥', '恐怖袭击', '毒品', '枪支', '政要'];

export function checkPrompt(prompt: string | undefined): void {
  if (!prompt) return;
  const hit = BLOCKED_PROMPT_WORDS.find((w) => prompt.includes(w));
  if (hit) throw err('MODERATION_REJECTED', `提示词包含不允许的内容（${hit}），请换一种描述`);
}

export interface ModerationResult {
  safe: boolean;
  reason?: string;
  provider: string;
}

export async function checkImage(row: ImageRow, stage: 'upload' | 'result'): Promise<ModerationResult> {
  if (config.MODERATION === 'none') return { safe: true, provider: 'none' };

  if (config.MODERATION === 'qwen-vl') {
    const buf = await loadBuffer(row);
    const res = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.LLM_API_KEY}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${row.mime};base64,${buf.toString('base64')}` } },
              {
                type: 'text',
                text: '判断这张图是否包含色情、未成年人不当内容、极端暴力或政治敏感内容。只输出 JSON：{"safe":true|false,"reason":"简短说明"}',
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      // 审核本身失败时放行还是拒绝？小范围工具选择放行并记日志，避免上游抖动卡死产品
      console.warn(`[moderation] 审核接口 ${res.status}，本次放行（${stage}）`);
      return { safe: true, provider: 'qwen-vl-degraded' };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    try {
      const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as { safe?: boolean; reason?: string };
      return { safe: parsed.safe !== false, reason: parsed.reason, provider: 'qwen-vl' };
    } catch {
      return { safe: true, provider: 'qwen-vl-unparsable' };
    }
  }

  return { safe: true, provider: 'none' };
}

export async function assertImageSafe(row: ImageRow, stage: 'upload' | 'result'): Promise<void> {
  const r = await checkImage(row, stage);
  if (!r.safe) {
    throw err('MODERATION_REJECTED', `图片未通过内容审核${r.reason ? `：${r.reason}` : ''}`);
  }
}
