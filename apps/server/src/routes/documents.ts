import type { FastifyInstance } from 'fastify';
import type { DocCanvas } from '@retouch/shared';
import { err } from '../lib/errors';
import { createBlankDocument, createDocument, getDoc, listDocs, patchDoc, removeDoc } from '../services/documents';
import { p, requireUser } from './_http';

export function documentRoutes(app: FastifyInstance): void {
  app.get('/api/documents', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { documents: listDocs(s.sub) } };
  });

  app.post('/api/documents', async (req) => {
    const s = requireUser(req);
    const b = (req.body ?? {}) as { title?: unknown; imageId?: string; canvas?: DocCanvas };
    const doc = b.imageId
      ? createDocument(s.sub, { title: b.title, imageId: b.imageId, canvas: b.canvas })
      : createBlankDocument(s.sub, typeof b.title === 'string' ? b.title : undefined);
    return { ok: true, data: { document: doc } };
  });

  app.get('/api/documents/:id', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { document: getDoc(p(req).id, s.sub) } };
  });

  app.patch('/api/documents/:id', async (req) => {
    const s = requireUser(req);
    const b = (req.body ?? {}) as { title?: unknown; canvas?: unknown; thumbImageId?: unknown };
    if (b.title === undefined && b.canvas === undefined && b.thumbImageId === undefined) {
      throw err('BAD_REQUEST', '没有要更新的内容');
    }
    return { ok: true, data: { document: patchDoc(p(req).id, s.sub, b) } };
  });

  app.delete('/api/documents/:id', async (req) => {
    const s = requireUser(req);
    removeDoc(p(req).id, s.sub);
    return { ok: true, data: { deleted: true } };
  });
}
