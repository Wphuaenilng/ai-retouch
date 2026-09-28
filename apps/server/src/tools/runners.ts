import type { Capability, ProviderRequest } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { requireOwned, saveImage, toProviderRef } from '../services/images';
import { assertImageSafe, checkPrompt } from '../services/moderation';
import { generate } from '../providers/registry';
import type { ImageRow } from '../store/images';

export interface RunCtx {
  userId: string;
  taskId: string;
  documentId: string | null;
  onProgress: (p: number) => void;
  /** 任务超时或进程退出时触发；要一路传到上游 fetch */
  signal?: AbortSignal;
}

export interface ToolRunResult {
  resultImageId: string | null;
  output?: Record<string, unknown>;
  costYuan: number;
  provider: string;
  model: string;
}

export type Runner = (ctx: RunCtx, params: Record<string, unknown>) => Promise<ToolRunResult>;

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** 比例 → 像素。基准边 1024，长边不超过 EDIT_COPY_MAX_EDGE*2，避免上游按面积多收钱 */
export function sizeForAspect(aspect: string | undefined, base = 1024): { width: number; height: number } {
  const ratio: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16, free: 1 };
  const r = ratio[aspect ?? '1:1'] ?? 1;
  const w = r >= 1 ? base : Math.round(base * r);
  const h = r >= 1 ? Math.round(base / r) : base;
  return { width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2 };
}

async function refOf(ctx: RunCtx, imageId: string): Promise<{ row: ImageRow; ref: ProviderRequest['images'][number] }> {
  const row = requireOwned(imageId, ctx.userId);
  return { row, ref: await toProviderRef(row) };
}

async function storeResult(
  ctx: RunCtx,
  img: { base64?: string; url?: string; mime?: string },
  kind: 'result' | 'mask' = 'result',
): Promise<ImageRow> {
  if (!img.base64) throw err('PROVIDER_FAILED', '上游只给了 URL，未落地为字节');
  const b64 = img.base64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  const row = await saveImage({ userId: ctx.userId, kind, buf, parentTaskId: ctx.taskId });
  await assertImageSafe(row, 'result', ctx.taskId);
  return row;
}

/** 统一封装：能力 → provider 调用 → 落盘 → 计费字段 */
async function call(
  ctx: RunCtx,
  cap: Capability,
  req: Omit<ProviderRequest, 'capability'>,
  promptToCheck?: string,
): Promise<{ row: ImageRow | null; rows: ImageRow[]; costYuan: number; provider: string; model: string }> {
  checkPrompt(promptToCheck ?? req.prompt);
  const res = await generate(cap, { ...req, capability: cap, idempotencyKey: ctx.taskId }, ctx.onProgress, {
    signal: ctx.signal,
  });
  if (ctx.signal?.aborted) throw new Error('任务已取消');
  const rows: ImageRow[] = [];
  for (const img of res.images) rows.push(await storeResult(ctx, img));
  return { row: rows[0] ?? null, rows, costYuan: res.costYuan, provider: res.provider, model: res.model };
}

export const RUNNERS: Record<string, Runner> = {
  text2image: async (ctx, p) => {
    const size = sizeForAspect(str(p.aspect));
    const r = await call(ctx, 'text2image', {
      prompt: str(p.prompt),
      images: [],
      size,
      count: num(p.count) ?? 1,
    });
    return {
      resultImageId: r.row?.id ?? null,
      // 报落盘的实际尺寸而非请求尺寸：上游可以不给正好那档（gpt-image 只认三档，16:9 会被吸附成 3:2）
      output: {
        imageIds: r.rows.map((x) => x.id),
        width: r.row?.width ?? size.width,
        height: r.row?.height ?? size.height,
      },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  prompt_edit: async (ctx, p) => {
    const { ref } = await refOf(ctx, String(p.imageId));
    const r = await call(ctx, 'edit', { prompt: str(p.prompt), images: [ref] });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  cutout: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const r = await call(ctx, 'segment', {
      prompt:
        p.mode === 'product'
          ? '抠出商品主体，背景透明，保留边缘细节'
          : p.mode === 'portrait'
            ? '抠出人物主体，背景透明，保留发丝边缘'
            : '抠出画面主体，背景透明',
      images: [ref],
      size: { width: row.width, height: row.height },
    });
    return {
      resultImageId: r.row?.id ?? null,
      output: { transparent: true },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  /** 交给编辑模型一步完成，服务端不做像素合成（无 sharp 依赖） */
  replace_background: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const color = str(p.color);
    const bg = str(p.backgroundImageId);
    const prompt = color
      ? `把背景替换为纯色 ${color}，主体边缘干净，光照与投影自然`
      : bg
        ? '用第二张图作为新背景替换第一张图的背景，保持主体不变、透视与光影一致'
        : `把背景替换为：${str(p.prompt) ?? '干净的摄影棚背景'}。保持主体完全不变，边缘干净，光影自然`;
    const images = bg ? [ref, (await refOf(ctx, bg)).ref] : [ref];
    const r = await call(ctx, 'edit', { prompt, images, size: { width: row.width, height: row.height } });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  erase: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const mask = (await refOf(ctx, String(p.maskImageId))).ref;
    const r = await call(ctx, 'inpaint', {
      prompt: str(p.prompt) ?? '去掉选区中的内容，用周围环境自然补全，不留痕迹',
      images: [ref],
      mask,
      size: { width: row.width, height: row.height },
    });
    return {
      resultImageId: r.row?.id ?? null,
      output: { maskImageId: String(p.maskImageId) },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  inpaint_replace: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const mask = (await refOf(ctx, String(p.maskImageId))).ref;
    const r = await call(ctx, 'inpaint', {
      prompt: `只修改选区内的内容为：${str(p.prompt) ?? ''}。选区外完全保持不变`,
      images: [ref],
      mask,
      size: { width: row.width, height: row.height },
    });
    return {
      resultImageId: r.row?.id ?? null,
      output: { maskImageId: String(p.maskImageId) },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  outpaint: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const target = sizeForAspect(str(p.targetRatio), Math.max(row.width, row.height));
    const r = await call(ctx, 'outpaint', {
      prompt: '向外扩展画面并自然补全，保持原图内容与比例居中',
      images: [ref],
      size: target,
    });
    return {
      resultImageId: r.row?.id ?? null,
      output: { width: target.width, height: target.height },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  upscale: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const scale = num(p.scale) ?? 2;
    const capEdge = config.EDIT_COPY_MAX_EDGE * 2;
    const w = Math.min(row.width * scale, capEdge);
    const h = Math.min(row.height * scale, capEdge);
    const r = await call(ctx, 'upscale', {
      prompt: '提升分辨率与细节清晰度，保持构图与色彩完全不变',
      images: [ref],
      size: { width: w, height: h },
    });
    return {
      resultImageId: r.row?.id ?? null,
      output: { width: Math.round(w), height: Math.round(h) },
      costYuan: r.costYuan,
      provider: r.provider,
      model: r.model,
    };
  },

  portrait_beautify: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const s = num(p.strength) ?? 0.5;
    const r = await call(ctx, 'portrait', {
      prompt: `人像美化：轻度磨皮去瑕疵、提亮肤色、保留皮肤纹理，强度 ${s.toFixed(2)}，不要改变五官与身份`,
      images: [ref],
      size: { width: row.width, height: row.height },
    });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  restore_photo: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const r = await call(ctx, 'edit', {
      prompt: p.colorize
        ? '修复老照片：去除折痕、噪点与划痕，提升清晰度，并自然上色'
        : '修复老照片：去除折痕、噪点与划痕，提升清晰度，保持原有色调',
      images: [ref],
      size: { width: row.width, height: row.height },
    });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  remove_text: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const maskId = str(p.maskImageId);
    const mask = maskId ? (await refOf(ctx, maskId)).ref : undefined;
    const r = await call(ctx, mask ? 'inpaint' : 'edit', {
      prompt: '去除画面上的文字、字幕与角标，用周围内容自然补全，不改动其他部分',
      images: [ref],
      ...(mask ? { mask } : {}),
      size: { width: row.width, height: row.height },
    });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  merge_images: async (ctx, p) => {
    const ids = (Array.isArray(p.imageIds) ? p.imageIds : []).map(String).slice(0, 4);
    if (ids.length < 2) throw err('TOOL_PARAMS_INVALID', '多图融合至少需要两张图');
    const rows = ids.map((id) => requireOwned(id, ctx.userId));
    // 每张图都要 base64 塞进同一个请求体，先把总量卡住，而不是等进程 OOM
    const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);
    if (totalBytes > config.maxUploadTotalBytes) {
      throw err(
        'TOOL_PARAMS_INVALID',
        `输入图合计 ${Math.round(totalBytes / 1048576)}MB，超过 ${config.MAX_UPLOAD_TOTAL_MB}MB 上限；请减少张数或改用编辑副本`,
      );
    }
    const refs = await Promise.all(rows.map((r) => toProviderRef(r)));
    const first = rows[0];
    const r = await call(ctx, 'edit', {
      prompt: str(p.prompt) ?? '把后面的图中的元素自然合成到第一张图中，光影与透视一致',
      images: refs,
      size: { width: first.width, height: first.height },
    });
    return { resultImageId: r.row?.id ?? null, costYuan: r.costYuan, provider: r.provider, model: r.model };
  },

  /** 主体 + 背景两张图，前端据此建两个图层；服务端不做合成 */
  split_layers: async (ctx, p) => {
    const { ref, row } = await refOf(ctx, String(p.imageId));
    const size = { width: row.width, height: row.height };

    const subject = await call(ctx, 'segment', { prompt: '抠出主体，背景透明', images: [ref], size });
    const background = await call(ctx, 'edit', {
      prompt: '移除画面中的所有主体，只保留背景，并按周围环境补全空缺',
      images: [ref],
      size,
    });
    return {
      resultImageId: subject.row?.id ?? null,
      output: {
        layers: [
          { name: '主体层', imageId: subject.row?.id ?? null },
          { name: '背景层', imageId: background.row?.id ?? null },
        ],
        ocr: Boolean(p.ocr),
      },
      costYuan: subject.costYuan + background.costYuan,
      provider: subject.provider,
      model: subject.model,
    };
  },
};

export function getRunner(tool: string): Runner | undefined {
  return RUNNERS[tool];
}
