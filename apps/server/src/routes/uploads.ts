import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { err } from '../lib/errors';
import { saveImage, toDTO } from '../services/images';
import { assertImageSafe } from '../services/moderation';
import { limit, requireUser } from './_http';

type Kind = 'original' | 'edit' | 'thumb' | 'mask';

/** 字段名 → 图片用途；同一用途只取先命中的字段 */
const ORDER: Array<[string, Kind]> = [
  ['file', 'original'],
  ['original', 'original'],
  ['edit', 'edit'],
  ['thumb', 'thumb'],
  ['mask', 'mask'],
];

/**
 * 上传：一次请求可带 file（原图）+ edit（前端压缩过的编辑副本）+ thumb + mask（画布选区）。
 * 只送 mask 也是合法请求——在画布上涂一片选区时并没有新图要传。
 * 服务端不做像素处理，所以"压缩"这件事必须在浏览器完成；
 * 这里只负责校验类型/尺寸、落盘、建记录、过审核。
 */
export function uploadRoutes(app: FastifyInstance): void {
  app.post('/api/uploads', async (req) => {
    const s = requireUser(req);
    limit(req, 'upload', 60, 60_000);
    if (!req.isMultipart()) throw err('BAD_REQUEST', '需要 multipart/form-data');

    const files: Record<string, { buf: Buffer; mime?: string }> = {};
    let total = 0;
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      total += buf.length;
      // 单文件有 multipart 的 fileSize 限制，但"一次传四个"的总量得自己盯，否则并发上传能把内存吃满
      if (total > config.maxUploadTotalBytes) {
        throw err('FILE_TOO_LARGE', `一次上传合计最大 ${config.MAX_UPLOAD_TOTAL_MB}MB`);
      }
      files[part.fieldname] = { buf, mime: part.mimetype };
    }
    // 遮罩可以单独上传：画布上涂一片选区时，用户手上并没有"原图"要传
    if (!ORDER.some(([field]) => files[field]))
      throw err('BAD_REQUEST', '没有收到可识别的图片字段（file / mask / edit / thumb）');
    const wantsOriginal = Boolean(files.file ?? files.original);

    const out: Record<string, ReturnType<typeof toDTO>> = {};
    for (const [field, kind] of ORDER) {
      const f = files[field];
      if (!f || out[kind]) continue;
      const row = await saveImage({ userId: s.sub, kind, buf: f.buf });
      await assertImageSafe(row, 'upload');
      out[kind] = toDTO(row);
    }
    if (wantsOriginal && !out.original) throw err('FILE_TYPE_UNSUPPORTED', '没有收到有效的图片');
    return { ok: true, data: out };
  });
}
