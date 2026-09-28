import { toolSpecForPlanner, type PlanDraft } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import type { PlanFacts } from './validator';

export interface PlanInput {
  message: string;
  facts: PlanFacts;
  /** 校验失败后的重试反馈，让模型自己改错一次 */
  feedback?: string[];
}
export interface PlanOutput {
  planner: string;
  draft: PlanDraft;
}

/** 规则式规划器：不依赖任何 key，也能把"换背景 + 裁 1:1 + 提亮"这类组合拆出来 */
export function mockPlan(input: PlanInput): PlanOutput {
  const m = input.message.replace(/\s+/g, '');
  const steps: PlanDraft['steps'] = [];
  const add = (tool: string, params: Record<string, unknown>, reason: string) => {
    const id = `s${steps.length + 1}`;
    steps.push({ id, tool, params, deps: steps.length ? [`s${steps.length}`] : [], reason });
  };

  const ratio = /(1:1|16:9|9:16|4:3|3:4)/.exec(m)?.[1];
  const colorMap: Record<string, string> = {
    纯白: '#ffffff',
    白色: '#ffffff',
    米白: '#f3efe8',
    奶白: '#f7f3ec',
    黑色: '#000000',
    浅灰: '#e9e9e5',
  };
  const color = Object.entries(colorMap).find(([k]) => m.includes(k))?.[1];
  const afterWord = /(?:换成|替换为|替换成|改为|改成)([^，。,;!！?？]+)/.exec(m)?.[1]?.trim();

  if (/(画|生成|来)(一|两|四)?[张幅]/.test(m) || /文生图/.test(m)) {
    add('text2image', { prompt: afterWord || input.message, ...(ratio ? { aspect: ratio } : {}) }, '按描述生成新图');
  }

  if (/背景/.test(m) && /(换|改|替换|去掉|移除|去除)/.test(m)) {
    add('replace_background', color ? { color } : { prompt: afterWord || '干净的摄影棚背景' }, '替换背景，主体保持不变');
  } else if (/背景/.test(m) && /(透明|抠)/.test(m)) {
    add('cutout', {}, '抠出主体并输出透明底');
  } else if (/抠图|抠出|透明底/.test(m)) {
    add('cutout', {}, '抠出主体');
  }

  if (/(水印|字幕|角标|文字)/.test(m) && /(去|抹|消除|清除)/.test(m)) {
    if (input.facts.hasSelection) add('erase', {}, '在选区内消除并补全背景');
    else add('remove_text', {}, '去除画面上的文字与角标');
  } else if (/(去掉|去除|消除|抹掉)(.*(人|物|车|物体|东西))/.test(m)) {
    if (input.facts.hasSelection) add('erase', {}, '消除选区中的物体');
    else add('erase', {}, '需要先框选要消除的物体');
  }

  if (/换成/.test(m) && input.facts.hasSelection && !/背景/.test(m)) {
    add('inpaint_replace', { prompt: afterWord || '选区内的新内容' }, '只替换选区内容');
  }

  if (/扩图|扩展画面|补全画面|向外扩/.test(m)) {
    add('outpaint', ratio ? { targetRatio: ratio } : {}, '向外扩展并补全');
  }

  if (/(裁|剪)/.test(m) || (/比例/.test(m) && ratio)) {
    add('transform', { target: 'canvas', cropRatio: ratio ?? '1:1' }, '按目标比例裁剪');
  } else if (ratio && !/扩图/.test(m)) {
    add('transform', { target: 'canvas', cropRatio: ratio }, `裁剪为 ${ratio}`);
  }

  if (/旋转|转90|横过来|竖过来/.test(m)) add('transform', { rotate: 90 }, '旋转 90°');
  if (/镜像|左右翻转|水平翻转/.test(m)) add('transform', { flipH: true }, '水平镜像');

  if (/超分|放大|变清晰|高清|分辨率/.test(m)) add('upscale', { scale: /4倍|4x/.test(m) ? 4 : 2 }, '提升分辨率');
  if (/磨皮|美颜|美化|祛痘|皮肤/.test(m)) add('portrait_beautify', { strength: 0.5 }, '人像美化');
  if (/老照片|划痕|折痕|修复|上色/.test(m)) {
    add('restore_photo', { colorize: /上色/.test(m) }, '修复老照片');
  }
  if (/黑白|去色/.test(m)) add('adjust', { saturation: -1 }, '转黑白');
  if (/分层|拆层|图层拆分/.test(m)) add('split_layers', { ocr: /文字层/.test(m) }, '拆成主体层与背景层');

  const adjust: Record<string, number> = {};
  if (/(亮|提亮)/.test(m) && !/暗/.test(m)) {
    const pct = /(\d{1,3})%/.exec(m);
    adjust.brightness = pct ? Math.min(1, Number(pct[1]) / 100) : 0.15;
  }
  if (/暗|调低亮度|降曝光/.test(m)) {
    const pct = /(\d{1,3})%/.exec(m);
    adjust.exposure = -1 * (pct ? Math.min(1, Number(pct[1]) / 100) : 0.15);
  }
  if (/饱和|鲜艳|颜色浓/.test(m)) adjust.saturation = 0.18;
  if (/对比/.test(m)) adjust.contrast = 0.15;
  if (/暖|夕阳|复古黄/.test(m)) adjust.temperature = 0.18;
  if (/冷|清冷|蓝调/.test(m)) adjust.temperature = -0.18;
  if (/锐化|清晰一?点/.test(m) && !/超分|放大|高清/.test(m)) adjust.sharpness = 0.35;
  if (/暗角/.test(m)) adjust.vignette = 0.35;
  if (/褪色|发灰/.test(m)) adjust.fade = 0.3;
  if (Object.keys(adjust).length) add('adjust', adjust, '整体调色');

  if (/导出|下载|存下来/.test(m)) add('export', {}, '导出成品');

  if (!steps.length) {
    throw err(
      'PLAN_EMPTY',
      '这个需求我暂时做不到。目前能处理：文生图、抠图、换背景、消除/去水印、局部替换、扩图、超分、人像美化、老照片修复、调色、裁剪旋转、图层拆分、多图融合、导出。',
    );
  }
  return { planner: 'mock-rules', draft: { summary: `拆成 ${steps.length} 步执行`, steps } };
}

const SYSTEM = `你是修图工作流的编排器，只输出 JSON，不输出解释文字。
可用工具（tool 字段必须严格取自这里）：
${toolSpecForPlanner()}

输出格式：{"summary":"一句话说明","steps":[{"id":"s1","tool":"工具名","params":{...},"deps":[] , "reason":"为什么需要这步"}]}
硬性规则：
1. 最多 6 步；deps 只能引用同计划内的 id。
2. params 里的 imageId / maskImageId 一律不要自己编造，省略即可，系统会用当前图片与当前选区自动补全。
3. 换背景只用 replace_background 一步完成，不要拆成 cutout + 编辑。
4. 用户说的"再亮一点/暗一点"这类相对指令，用 adjust 的小幅参数（±0.1~0.2）表达。
5. 没有合适工具时输出 {"steps":[]}，不要硬凑。`;

async function llmPlan(input: PlanInput): Promise<PlanOutput> {
  const facts = [
    `当前图片：${input.facts.currentImageId ? '有' : '没有'}`,
    `当前选区：${input.facts.hasSelection ? '有' : '没有'}`,
    `图层数：${input.facts.layerIds.length}`,
    `文档内图片数：${input.facts.hasMultipleImages ? '多张' : '一张'}`,
  ].join('，');

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `需求：${input.message}\n画布事实：${facts}` },
  ];
  if (input.feedback?.length) {
    messages.push({ role: 'user', content: `上一次计划被系统拒绝，原因：${input.feedback.join('；')}\n请修正后重新输出 JSON。` });
  }

  let res: Response;
  try {
    res = await fetch(`${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.LLM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.LLM_MODEL, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw err('PROVIDER_FAILED', `规划模型连不上：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw err('PROVIDER_FAILED', `规划模型返回 ${res.status}：${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const grab = /\{[\s\S]*\}/.exec(text);
    if (!grab) throw err('PROVIDER_FAILED', '规划模型没有返回 JSON');
    parsed = JSON.parse(grab[0]);
  }
  const draft = {
    summary: (parsed as PlanDraft).summary,
    steps: ((parsed as PlanDraft).steps ?? []).slice(0, 6).map((s, i) => ({
      id: s.id || `s${i + 1}`,
      tool: String(s.tool),
      params: s.params ?? {},
      deps: Array.isArray(s.deps) ? s.deps.map(String) : [],
      reason: s.reason,
    })),
  };
  if (!draft.steps.length) {
    throw err('PLAN_EMPTY', '这个需求超出了我当前可用的修图工具范围，可以换个说法或分步做。');
  }
  return { planner: `llm:${config.LLM_MODEL}`, draft };
}

export async function plan(input: PlanInput): Promise<PlanOutput> {
  if (config.LLM_PLAN_PROVIDER === 'openai' && config.LLM_API_KEY) return llmPlan(input);
  return mockPlan(input);
}

export const plannerName = (): string =>
  config.LLM_PLAN_PROVIDER === 'openai' && config.LLM_API_KEY ? `llm:${config.LLM_MODEL}` : 'mock-rules';
