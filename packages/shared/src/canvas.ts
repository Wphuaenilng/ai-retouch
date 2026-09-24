/**
 * 画布文档结构（存 documents.canvas）。前端编辑器与服务端共用，
 * 保存时服务端用这里的 schema 校验，避免脏 JSON 写库。
 */
import { z } from 'zod';

export const layerTransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  rotation: z.number(),
});

export const layerKindSchema = z.enum(['base', 'subject', 'background', 'adjust', 'mask']);

export const docLayerSchema = z.object({
  id: z.string().min(1),
  kind: layerKindSchema,
  name: z.string().min(1).max(60),
  imageId: z.string().min(1).nullish(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  blend: z.enum(['normal', 'multiply', 'screen']),
  transform: layerTransformSchema,
  adjust: z.record(z.string(), z.number()).optional(),
});

export const docCanvasSchema = z.object({
  width: z.number().int().positive().max(12000),
  height: z.number().int().positive().max(12000),
  sourceImageId: z.string().min(1).nullable(),
  layers: z.array(docLayerSchema).max(40),
  activeLayerId: z.string().min(1).nullish(),
  selection: z
    .object({
      kind: z.enum(['rect', 'lasso', 'brush']),
      maskImageId: z.string().min(1).nullish(),
    })
    .nullable()
    .optional(),
});

export type DocLayerParsed = z.infer<typeof docLayerSchema>;
export type DocCanvasParsed = z.infer<typeof docCanvasSchema>;

/** 新建文档时的默认单层结构；sourceImageId 为 null 表示空白画布 */
export function baseCanvas(width: number, height: number, sourceImageId: string | null, name = '原图') {
  return {
    width,
    height,
    sourceImageId,
    activeLayerId: sourceImageId ? 'L1' : null,
    layers: sourceImageId
      ? [
          {
            id: 'L1',
            kind: 'base' as const,
            name,
            imageId: sourceImageId,
            visible: true,
            opacity: 1,
            blend: 'normal' as const,
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          },
        ]
      : [],
  };
}
