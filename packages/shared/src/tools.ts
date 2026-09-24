/**
 * 工具注册表 —— 工具箱 UI、Agent 规划、服务端执行器共用同一份定义。
 * 新增工具只改这里：加一个 ToolDef（含 fields 表单描述），然后在
 * server/src/tools/runners.ts 与 web/src/lib/clientTools.ts 各实现同名 runner。
 */
import { z } from 'zod';
import type { FieldSpec, ToolDef } from './types';

const ref = {
  imageId: z.string().min(1),
  maskImageId: z.string().min(1),
  prompt: z.string().min(1).max(600),
};

const aspect = z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', 'free']);

/* 常用字段 */
const F = {
  imageId: { key: 'imageId', label: '输入图片', kind: 'imageRef' } as FieldSpec,
  mask: {
    key: 'maskImageId',
    label: '选区',
    kind: 'imageRef',
    needsSelection: true,
    hint: '在画布上涂抹或框选要处理的区域',
  } as FieldSpec,
  prompt: (label: string, placeholder: string): FieldSpec => ({ key: 'prompt', label, kind: 'textarea', placeholder }),
  aspectOptions: [
    { value: '1:1', label: '1:1 方图' },
    { value: '4:3', label: '4:3 横' },
    { value: '3:4', label: '3:4 竖' },
    { value: '16:9', label: '16:9 宽' },
    { value: '9:16', label: '9:16 手机' },
    { value: 'free', label: '原比例' },
  ],
};

/* ------------------------------------------------------------------ *
 * 本地工具（零成本、即时、可撤销；Agent 也能调用，走 client_command 下发）
 * ------------------------------------------------------------------ */

const adjust: ToolDef = {
  name: 'adjust',
  title: '调色',
  group: 'local',
  executor: 'client',
  icon: 'i-adjust',
  priority: 0,
  needsImage: true,
  produces: 'layers',
  costYuan: 0,
  fields: [
    { key: 'brightness', label: '亮度', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'exposure', label: '曝光', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'contrast', label: '对比度', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'saturation', label: '饱和度', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'temperature', label: '色温', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'tint', label: '色调', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'highlights', label: '高光', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'shadows', label: '阴影', kind: 'slider', min: -1, max: 1, step: 0.01 },
    { key: 'sharpness', label: '锐化', kind: 'slider', min: 0, max: 1, step: 0.01 },
    { key: 'vignette', label: '暗角', kind: 'slider', min: 0, max: 1, step: 0.01 },
    { key: 'fade', label: '褪色', kind: 'slider', min: 0, max: 1, step: 0.01 },
  ],
  agentHint:
    '调整曝光/明暗/色彩等全局观感时用。所有参数是 -1~1 的相对量（sharpness/vignette/fade 为 0~1）。"再亮一点"给 +0.1~0.2，"暗一点"给负值，"黑白"用 saturation:-1。',
  paramsHint:
    '{brightness?,contrast?,saturation?,temperature?,tint?,exposure?,highlights?,shadows?,sharpness?,vignette?,fade?} 各为数字；layerId? 指定作用图层，省略则作用于新建调整层',
  input: z.object({
    layerId: z.string().min(1).optional(),
    brightness: z.number().min(-1).max(1).optional(),
    contrast: z.number().min(-1).max(1).optional(),
    saturation: z.number().min(-1).max(1).optional(),
    temperature: z.number().min(-1).max(1).optional(),
    tint: z.number().min(-1).max(1).optional(),
    exposure: z.number().min(-1).max(1).optional(),
    highlights: z.number().min(-1).max(1).optional(),
    shadows: z.number().min(-1).max(1).optional(),
    sharpness: z.number().min(0).max(1).optional(),
    vignette: z.number().min(0).max(1).optional(),
    fade: z.number().min(0).max(1).optional(),
  }),
};

const transform: ToolDef = {
  name: 'transform',
  title: '裁剪 / 变换',
  group: 'local',
  executor: 'client',
  icon: 'i-crop',
  priority: 0,
  needsImage: true,
  produces: 'layers',
  costYuan: 0,
  fields: [
    { key: 'cropRatio', label: '裁剪比例', kind: 'select', options: F.aspectOptions },
    { key: 'rotate', label: '旋转角度', kind: 'number', min: -360, max: 360, step: 1 },
    { key: 'flipH', label: '水平镜像', kind: 'toggle' },
    { key: 'flipV', label: '垂直翻转', kind: 'toggle' },
  ],
  agentHint:
    '改变画布比例、裁掉边缘、旋转、镜像时用。"裁成正方形/1:1/用于电商主图"→ cropRatio:"1:1"；"横过来/旋转90度"→ rotate:90。',
  paramsHint:
    '{target?:canvas|layer, layerId?, cropRatio?:1:1|4:3|3:4|16:9|9:16|free, cropRect?:{x,y,w,h}, rotate?, flipH?, flipV?} 角度为度数',
  input: z.object({
    target: z.enum(['canvas', 'layer']).optional(),
    layerId: z.string().min(1).optional(),
    cropRatio: aspect.optional(),
    cropRect: z
      .object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
      .optional(),
    rotate: z.number().min(-360).max(360).optional(),
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
  }),
};

const exportDoc: ToolDef = {
  name: 'export',
  title: '导出',
  group: 'local',
  executor: 'client',
  icon: 'i-export',
  priority: 0,
  needsImage: true,
  produces: 'none',
  costYuan: 0,
  fields: [
    {
      key: 'format',
      label: '格式',
      kind: 'select',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
        { value: 'webp', label: 'WebP' },
      ],
    },
    { key: 'quality', label: '质量', kind: 'slider', min: 0.3, max: 1, step: 0.05 },
    {
      key: 'scale',
      label: '倍率',
      kind: 'select',
      options: [
        { value: 1, label: '1×' },
        { value: 2, label: '2×' },
      ],
    },
  ],
  agentHint: '仅当用户明确要"导出/下载/保存成品"时用；默认不需要，用户自己会点导出。',
  paramsHint: '{format?:png|jpeg|webp, quality?:0-1, scale?:1|2}',
  input: z.object({
    format: z.enum(['png', 'jpeg', 'webp']).optional(),
    quality: z.number().min(0.1).max(1).optional(),
    scale: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
};

/* ------------------------------------------------------------------ *
 * AI 工具（走云端模型，计入配额与成本）
 * ------------------------------------------------------------------ */

const text2image: ToolDef = {
  name: 'text2image',
  title: '文生图',
  group: 'ai',
  executor: 'server',
  capability: 'text2image',
  icon: 'i-plus',
  priority: 0,
  needsImage: false,
  produces: 'image',
  costYuan: 0.2,
  fields: [
    F.prompt('提示词', '例：晨光里的手冲咖啡与陶壶，木桌，胶片质感，暖色调'),
    { key: 'aspect', label: '比例', kind: 'select', options: F.aspectOptions },
    {
      key: 'resolution',
      label: '清晰度',
      kind: 'select',
      options: [
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K · 加价' },
      ],
    },
    {
      key: 'count',
      label: '张数',
      kind: 'select',
      options: [
        { value: 4, label: '4 张候选' },
        { value: 2, label: '2 张' },
        { value: 1, label: '1 张' },
      ],
    },
  ],
  agentHint: '从文字生成全新图片，不需要输入图。一次最多 4 张候选。',
  paramsHint: '{prompt, aspect?:1:1|4:3|3:4|16:9|9:16|free, resolution?:2K|4K, count?:1|2|4}',
  input: z.object({
    prompt: ref.prompt,
    aspect: aspect.optional(),
    resolution: z.enum(['2K', '4K']).optional(),
    count: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
  }),
};

const promptEdit: ToolDef = {
  name: 'prompt_edit',
  title: '提示词编辑',
  group: 'ai',
  executor: 'server',
  capability: 'edit',
  icon: 'i-heal',
  priority: 0,
  needsImage: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [F.imageId, F.prompt('改动描述', '例：改成傍晚的暖色逆光，其他都不变')],
  agentHint:
    '对整张图做语义级改动且不限定区域时用：换风格、改天气、加/减整体元素、老照片上色。只改局部请优先用 erase 或 inpaint_replace。',
  paramsHint: '{imageId, prompt}',
  input: z.object({ imageId: ref.imageId, prompt: ref.prompt }),
};

const cutout: ToolDef = {
  name: 'cutout',
  title: '抠图',
  group: 'ai',
  executor: 'server',
  capability: 'segment',
  icon: 'i-cut',
  priority: 0,
  needsImage: true,
  produces: 'image',
  costYuan: 0.03,
  fields: [
    F.imageId,
    {
      key: 'mode',
      label: '主体类型',
      kind: 'select',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'product', label: '商品' },
        { value: 'portrait', label: '人像' },
      ],
    },
  ],
  agentHint: '把主体从背景中分离，输出透明底 PNG。是换背景的前置步骤。',
  paramsHint: '{imageId, mode?:auto|product|portrait}',
  input: z.object({
    imageId: ref.imageId,
    mode: z.enum(['auto', 'product', 'portrait']).optional(),
  }),
};

const replaceBackground: ToolDef = {
  name: 'replace_background',
  title: '换背景',
  group: 'ai',
  executor: 'server',
  capability: 'edit',
  icon: 'i-bg',
  priority: 0,
  needsImage: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [
    F.imageId,
    F.prompt('新背景', '例：米白色摄影棚，柔和顶光，边缘干净'),
    { key: 'color', label: '或纯色背景', kind: 'color', hint: '填了就忽略上面的文字描述' },
  ],
  agentHint:
    '"把背景换成…"一律用这个工具，它内部会自动完成抠图 + 背景生成/纯色填充，不要拆成 cutout + prompt_edit。',
  paramsHint:
    '{imageId, prompt?, color?:#rrggbb, backgroundImageId?} 三者选一：文字描述新背景 / 纯色 / 指定一张图作背景',
  input: z
    .object({
      imageId: ref.imageId,
      prompt: z.string().min(1).max(600).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      backgroundImageId: z.string().min(1).optional(),
    })
    .refine((v) => Boolean(v.prompt || v.color || v.backgroundImageId), {
      message: '需要 prompt / color / backgroundImageId 之一',
    }),
};

const erase: ToolDef = {
  name: 'erase',
  title: '消除 / 去水印',
  group: 'ai',
  executor: 'server',
  capability: 'inpaint',
  icon: 'i-eraser',
  priority: 0,
  needsImage: true,
  needsMask: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [F.imageId, F.mask, F.prompt('（可选）补全提示', '例：干净的木桌面，保留光影方向')],
  agentHint:
    '把选区内的内容抹掉并用周围纹理补全：去水印、去路人、去杂物。必须已有选区（maskImageId），否则应提示用户先在画布上涂抹或框选。',
  paramsHint: '{imageId, maskImageId, prompt?}',
  input: z.object({
    imageId: ref.imageId,
    maskImageId: ref.maskImageId,
    prompt: z.string().max(300).optional(),
  }),
};

const inpaintReplace: ToolDef = {
  name: 'inpaint_replace',
  title: '局部替换',
  group: 'ai',
  executor: 'server',
  capability: 'inpaint',
  icon: 'i-layers',
  priority: 0,
  needsImage: true,
  needsMask: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [F.imageId, F.mask, F.prompt('换成什么', '例：一把深灰色布艺单人沙发')],
  agentHint:
    '在选区内换成别的东西（"把沙发换成单人椅"），选区外保持不变。必须已有选区。与 erase 的区别：这个要给出替换内容的描述。',
  paramsHint: '{imageId, maskImageId, prompt}',
  input: z.object({ imageId: ref.imageId, maskImageId: ref.maskImageId, prompt: ref.prompt }),
};

const outpaint: ToolDef = {
  name: 'outpaint',
  title: '扩图',
  group: 'ai',
  executor: 'server',
  capability: 'outpaint',
  icon: 'i-expand',
  priority: 0,
  needsImage: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [
    F.imageId,
    { key: 'targetRatio', label: '目标比例', kind: 'select', options: F.aspectOptions },
    {
      key: 'expand',
      label: '扩展方向',
      kind: 'select',
      options: [
        { value: 'all', label: '四周' },
        { value: 'left', label: '向左' },
        { value: 'right', label: '向右' },
        { value: 'top', label: '向上' },
        { value: 'bottom', label: '向下' },
      ],
    },
  ],
  agentHint: '向外扩展画幅并补全画面，用于改比例或留出文案空间。',
  paramsHint: '{imageId, targetRatio?:1:1|4:3|3:4|16:9|9:16, expand?:all|left|right|top|bottom}',
  input: z.object({
    imageId: ref.imageId,
    targetRatio: aspect.optional(),
    expand: z.enum(['all', 'left', 'right', 'top', 'bottom']).optional(),
  }),
};

const upscale: ToolDef = {
  name: 'upscale',
  title: '超分放大',
  group: 'ai',
  executor: 'server',
  capability: 'upscale',
  icon: 'i-upscale',
  priority: 0,
  needsImage: true,
  produces: 'image',
  costYuan: 0.12,
  fields: [
    F.imageId,
    {
      key: 'scale',
      label: '倍数',
      kind: 'select',
      options: [
        { value: 2, label: '2×' },
        { value: 4, label: '4×' },
      ],
    },
  ],
  agentHint: '提升分辨率与清晰度（"变清晰""放大""做海报尺寸"）。',
  paramsHint: '{imageId, scale?:2|4}',
  input: z.object({ imageId: ref.imageId, scale: z.union([z.literal(2), z.literal(4)]).optional() }),
};

const portraitBeautify: ToolDef = {
  name: 'portrait_beautify',
  title: '人像美化',
  group: 'ai',
  executor: 'server',
  capability: 'portrait',
  icon: 'i-heal',
  priority: 1,
  needsImage: true,
  produces: 'image',
  costYuan: 0.08,
  fields: [F.imageId, { key: 'strength', label: '强度', kind: 'slider', min: 0, max: 1, step: 0.05 }],
  agentHint: '磨皮、去瑕疵、提亮肤色。strength 越大改动越明显，人像默认 0.5。',
  paramsHint: '{imageId, strength?:0-1}',
  input: z.object({ imageId: ref.imageId, strength: z.number().min(0).max(1).optional() }),
};

const restorePhoto: ToolDef = {
  name: 'restore_photo',
  title: '老照片修复',
  group: 'ai',
  executor: 'server',
  capability: 'edit',
  icon: 'i-heal',
  priority: 1,
  needsImage: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [F.imageId, { key: 'colorize', label: '同时上色', kind: 'toggle' }],
  agentHint: '修复折痕噪点划痕，可选上色。扫描件、旧照片用这个。',
  paramsHint: '{imageId, colorize?:boolean}',
  input: z.object({ imageId: ref.imageId, colorize: z.boolean().optional() }),
};

const removeText: ToolDef = {
  name: 'remove_text',
  title: '消除文字',
  group: 'ai',
  executor: 'server',
  capability: 'inpaint',
  icon: 'i-text',
  priority: 1,
  needsImage: true,
  produces: 'image',
  costYuan: 0.26,
  fields: [F.imageId, { ...F.mask, label: '选区（可选）', needsSelection: false }],
  agentHint: '去除画面上的字幕、标语、角标等成块文字。有选区时优先用 erase。',
  paramsHint: '{imageId, maskImageId?}',
  input: z.object({ imageId: ref.imageId, maskImageId: z.string().min(1).optional() }),
};

const mergeImages: ToolDef = {
  name: 'merge_images',
  title: '多图融合',
  group: 'ai',
  executor: 'server',
  capability: 'edit',
  icon: 'i-layers',
  priority: 1,
  needsImage: false,
  produces: 'image',
  costYuan: 0.26,
  fields: [
    { key: 'imageIds', label: '图片（第一张为底图）', kind: 'imageRef', hint: '至少两张' },
    F.prompt('融合说明', '例：把第二张的衣服穿到第一张身上，保持人物不变'),
  ],
  agentHint: '把 2~4 张图合成一张：换装、把产品放进场景、风格迁移。第一张是底图。',
  paramsHint: '{imageIds:[2-4 个], prompt}',
  input: z.object({ imageIds: z.array(z.string().min(1)).min(2).max(4), prompt: ref.prompt }),
};

const splitLayers: ToolDef = {
  name: 'split_layers',
  title: '图层拆分',
  group: 'ai',
  executor: 'server',
  capability: 'segment',
  icon: 'i-layers',
  priority: 1,
  needsImage: true,
  produces: 'layers',
  // 两次上游调用：segment（抠主体）+ edit（补背景），别写成单次价
  costYuan: 0.29,
  fields: [F.imageId, { key: 'ocr', label: '尝试拆出文字层', kind: 'toggle' }],
  agentHint: '把一张图拆成主体层 + 背景层（可选文字层），拆完各层可独立移动调色。',
  paramsHint: '{imageId, ocr?:boolean}',
  input: z.object({ imageId: ref.imageId, ocr: z.boolean().optional() }),
};

/* ------------------------------------------------------------------ *
 * 注册表
 * ------------------------------------------------------------------ */

export const TOOLS: ToolDef[] = [
  adjust,
  transform,
  exportDoc,
  text2image,
  promptEdit,
  cutout,
  replaceBackground,
  erase,
  inpaintReplace,
  outpaint,
  upscale,
  portraitBeautify,
  restorePhoto,
  removeText,
  mergeImages,
  splitLayers,
];

const MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return MAP.get(name);
}

export function isKnownTool(name: string): boolean {
  return MAP.has(name);
}

export function toolsByGroup(group: 'ai' | 'local'): ToolDef[] {
  return TOOLS.filter((t) => t.group === group);
}

export function serverTools(): ToolDef[] {
  return TOOLS.filter((t) => t.executor === 'server');
}

export function clientTools(): ToolDef[] {
  return TOOLS.filter((t) => t.executor === 'client');
}

/** 工具箱可见的工具（priority 2 的先藏着） */
export function visibleTools(): ToolDef[] {
  return TOOLS.filter((t) => t.priority <= 1);
}

/** 喂给规划模型的工具清单文本（比 JSON Schema 省 token，也更不容易被模型改写） */
export function toolSpecForPlanner(): string {
  return TOOLS.filter((t) => t.priority <= 1)
    .map(
      (t) =>
        `- ${t.name}（${t.title}｜${t.executor}｜约 ¥${t.costYuan}）\n  何时用：${t.agentHint}\n  参数：${t.paramsHint}`,
    )
    .join('\n');
}

/** 校验并钳制参数；返回 { ok, value | issues } */
export function validateToolParams(
  name: string,
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; issues: string[] } {
  const tool = MAP.get(name);
  if (!tool) return { ok: false, issues: [`未知工具 ${name}`] };
  const parsed = tool.input.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`),
    };
  }
  const value = Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(([, v]) => v !== undefined),
  );
  return { ok: true, value };
}
