import type { FastifyInstance } from 'fastify';
import { err } from '../lib/errors';
import { mimeOfPath } from '../lib/storage';
import { verifySignedImage } from '../lib/signurl';
import { loadBuffer, toDTO } from '../services/images';
import { findImage } from '../store/images';
import { listImages } from '../store/images';
import { p, requireUser } from './_http';

/**
 * 图片读取：登录 Cookie 或签名 URL 二选一。
 * 签名 URL 是给上游模型回拉图片用的，短期有效、只读单张。
 */
export function imageRoutes(app: FastifyInstance): void {
  app.get('/api/images/:id', async (req, reply) => {
    const q = req.query as { exp?: string; sig?: string };
    const row = findImage(p(req).id);
    if (!row) throw err('NOT_FOUND', '图片不存在');

    const signed = q.sig && q.exp ? verifySignedImage(row.id, q.exp, q.sig) : false;
    if (!signed) {
      const s = requireUser(req);
      if (row.user_id !== s.sub) throw err('FORBIDDEN', '无权访问这张图');
    }

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
    const q = req.query as { kinds?: string; limit?: string };
    const kinds = q.kinds?.split(',').filter(Boolean);
    const rows = listImages(s.sub, { kinds, limit: Number(q.limit ?? 60) });
    return { ok: true, data: { images: rows.map(toDTO) } };
  });
}
