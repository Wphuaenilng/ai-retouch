import type { FastifyInstance } from 'fastify';
import { err } from '../lib/errors';
import { saveImage, toDTO } from '../services/images';
import { assertImageSafe } from '../services/moderation';
import { limit, requireUser } from './_http';

type Kind = 'original' | 'edit' | 'thumb' | 'mask';
const KINDS = new Set<Kind>(['original', 'edit', 'thumb', 'mask']);

/**
 * 上传：一次请求可带 file（原图，必填）+ edit（前端压缩过的编辑副本）+ thumb。
 * 服务端不做像素处理，所以"压缩"这件事必须在浏览器完成；
 * 这里只负责校验类型/尺寸、落盘、建记录、过审核。
 */
export function uploadRoutes(app: FastifyInstance): void {
  app.post('/api/uploads', async (req) => {
    const s = requireUser(req);
    limit(req, 'upload', 60, 60_000);
    if (!req.isMultipart()) throw err('BAD_REQUEST', '需要 multipart/form-data');

    const files: Record<string, { buf: Buffer; mime?: string }> = {};
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      files[part.fieldname] = { buf, mime: part.mimetype };
    }
    if (!files.file && !files.original) throw err('BAD_REQUEST', '没有收到图片文件（字段名应为 file）');

    const out: Record<string, ReturnType<typeof toDTO>> = {};
    const order: Array<[string, Kind]> = [
      ['file', 'original'],
      ['original', 'original'],
      ['edit', 'edit'],
      ['thumb', 'thumb'],
      ['mask', 'mask'],
    ];
    for (const [field, kind] of order) {
      const f = files[field];
      if (!f || !KINDS.has(kind)) continue;
      if (out[kind] && kind !== 'original') continue;
      const row = await saveImage({ userId: s.sub, kind, buf: f.buf });
      await assertImageSafe(row, 'upload');
      out[kind] = toDTO(row);
    }
    if (!out.original) throw err('FILE_TYPE_UNSUPPORTED', '没有收到有效的图片');
    return { ok: true, data: out };
  });
}
