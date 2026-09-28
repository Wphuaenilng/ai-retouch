import type { FastifyInstance } from 'fastify';
import { err } from '../lib/errors';
import { mimeOfPath } from '../lib/storage';
import { loadBuffer, purgeImages, toDTO } from '../services/images';
import { intParam } from '../lib/parse';
import { findDerived, findImage } from '../store/images';
import { listImages } from '../store/images';
import { p, requireUser } from './_http';

/**
 * 图片读取：只认登录 Cookie。
 * 以前这里还接受"签名 URL 免 Cookie"，但签发侧从没被任何 provider 调用过，
 * 于是那条分支是纯粹的攻击面而没有收益 —— 已经连同 lib/signurl.ts 一起删掉。
 * 真要接只收公网 URL 的上游时，把签发与校验一起做回来（见 docs/03 §3.2 的说明）。
 */
export function imageRoutes(app: FastifyInstance): void {
  app.get('/api/images/:id', async (req, reply) => {
    const s = requireUser(req);
    const row = findImage(p(req).id);
    if (!row) throw err('NOT_FOUND', '图片不存在');
    if (row.user_id !== s.sub) throw err('FORBIDDEN', '无权访问这张图');

    const buf = await loadBuffer(row);
    const mime = mimeOfPath(row.path) || row.mime;
    reply
      .header('content-type', mime)
      .header('cache-control', 'private, max-age=86400')
      .header('x-content-type-options', 'nosniff');
    if (mime === 'image/svg+xml') reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(buf);
  });

  app.get('/api/images', async (req) => {
    const s = requireUser(req);
    const q = req.query as { kinds?: string; limit?: string; documentId?: string };
    const kinds = q.kinds?.split(',').filter(Boolean);
    const rows = listImages(s.sub, {
      kinds,
      documentId: q.documentId,
      limit: intParam(q.limit, { name: 'limit', default: 60, max: 200 }),
    });
    return { ok: true, data: { images: rows.map(toDTO) } };
  });

  // 删一张图 = 删文件 + 删行 + 把它从所有画布与任务引用里摘掉。
  // 同一次上传派生出的编辑副本与缩略图跟着走，否则它们变成没人引用的孤儿文件。
  app.delete('/api/images/:id', async (req) => {
    const s = requireUser(req);
    const row = findImage(p(req).id);
    // 与 GET 同一套口径：不存在 404、别人的 403。
    // 这里不能图省事用 requireOwned —— 它把两者都报成 404，读和删就不一致了
    if (!row) throw err('NOT_FOUND', '图片不存在');
    if (row.user_id !== s.sub) throw err('FORBIDDEN', '无权删除这张图');
    const group = [row, ...findDerived(s.sub, row.id)];
    const r = await purgeImages(group, s.sub);
    return { ok: true, data: { deleted: r.images, files: r.files } };
  });
}
