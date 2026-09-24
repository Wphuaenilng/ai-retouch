import type { FastifyInstance } from 'fastify';
import { openEventStream } from '../lib/sse';
import { requireUser } from './_http';

export function eventRoutes(app: FastifyInstance): void {
  app.get('/api/events', async (req, reply) => {
    const s = requireUser(req);
    const last = (req.headers['last-event-id'] as string | undefined) ?? (req.query as { lastEventId?: string })?.lastEventId;
    openEventStream(reply, s.sub, last);
  });
}
