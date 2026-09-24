import { config } from '../config';
import { err } from '../lib/errors';
import type { ImageRow } from '../store/images';
import { loadBuffer } from './images';

/**
 * 内容安全。默认 none（小范围邀请制），生产分享前建议开 qwen-vl：
 * 用多模态模型对上传图与生成图做一次粗筛。
 * 阿里云内容安全（Green）更合规，接入点在下方 switch 里留好了。
 */
const DEFAULT_BLOCK_WORDS = ['未成年', '儿童色情', '色情', '裸露', '血腥', '恐怖袭击', '毒品', '枪支', '政要'];

/** 每次读，不缓存：测试要能换表，改配置也无需热重载逻辑 */
function blockWords(): string[] {
  const custom = config.MODERATION_BLOCK_WORDS.trim();
  if (!custom) return DEFAULT_BLOCK_WORDS;
  // 显式配置 = 整表替换。"既保留默认又新增"用一份字符串表达不清，宁可让人自己抄
  return custom
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkPrompt(prompt: string | undefined): void {
  if (!prompt) return;
  const hit = blockWords().find((w) => prompt.includes(w));
  if (hit) throw err('MODERATION_REJECTED', `提示词包含不允许的内容（${hit}），请换一种描述`);
}

export interface ModerationResult {
  safe: boolean;
  /** 审核本身没跑成（接口挂了 / 返回读不懂）。result 阶段按不放行处理 */
  degraded?: boolean;
  reason?: string;
  provider: string;
}

/**
 * 审核自己出故障时放行还是拒绝，分档处理：
 *   upload  —— 放行。上游抖一下不该把所有人的工作台锁死，而且图还在自己库里没发出去。
 *   result  —— 拒绝。这一张是要导出、要发给别人看的成品，宁停不错发。
 * 拒绝时给的是 MODERATION_UNAVAILABLE 而不是 MODERATION_REJECTED：服务故障不该说成用户违规。
 */
function degrade(stage: 'upload' | 'result', reason: string, provider: string): ModerationResult {
  const blocked = stage === 'result';
  console.warn(`[moderation] 审核不可用（${reason}），${blocked ? 'result 阶段拒绝出图' : 'upload 阶段放行'}`);
  return { safe: !blocked, degraded: true, reason, provider };
}

export async function checkImage(row: ImageRow, stage: 'upload' | 'result'): Promise<ModerationResult> {
  if (config.MODERATION !== 'qwen-vl') return { safe: true, provider: 'none' };

  let res: Response;
  try {
    const buf = await loadBuffer(row);
    res = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
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
  } catch (e) {
    return degrade(stage, (e as Error).name, 'qwen-vl');
  }
  if (!res.ok) return degrade(stage, `HTTP ${res.status}`, 'qwen-vl');

  try {
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as { safe?: boolean; reason?: string };
    return { safe: parsed.safe !== false, reason: parsed.reason, provider: 'qwen-vl' };
  } catch {
    return degrade(stage, '返回不是可读 JSON', 'qwen-vl');
  }
}

export async function assertImageSafe(row: ImageRow, stage: 'upload' | 'result'): Promise<void> {
  const r = await checkImage(row, stage);
  if (r.safe) return;
  if (r.degraded) throw err('MODERATION_UNAVAILABLE', '内容审核服务暂时不可用，为避免漏审本次不出图，请稍后重试');
  throw err('MODERATION_REJECTED', `图片未通过内容审核${r.reason ? `：${r.reason}` : ''}`);
}
