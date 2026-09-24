import type { FastifyInstance } from 'fastify';
import { err } from '../lib/errors';
import { approvePlan, cancelPlan, createPlan, listUserPlans, reportClientReceipt, retryStep, skipStep } from '../services/agent';
import { p, limit, requireUser } from './_http';

export function agentRoutes(app: FastifyInstance): void {
  app.post('/api/agent/plans', async (req) => {
    const s = requireUser(req);
    limit(req, 'plan', 20, 60_000);
    const b = (req.body ?? {}) as { message?: string; documentId?: string };
    if (!b.documentId) throw err('BAD_REQUEST', '需要一个文档上下文');
    const plan = await createPlan({ userId: s.sub, documentId: b.documentId, message: String(b.message ?? '') });
    return { ok: true, data: { plan } };
  });

  app.get('/api/agent/plans', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { plans: listUserPlans(s.sub) } };
  });

  app.post('/api/agent/plans/:id/approve', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { plan: approvePlan(p(req).id, s.sub) } };
  });

  app.post('/api/agent/plans/:id/cancel', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { plan: cancelPlan(p(req).id, s.sub) } };
  });

  app.post('/api/agent/plans/:id/steps/:idx/retry', async (req) => {
    const s = requireUser(req);
    const idx = Number(p(req).idx);
    if (!Number.isInteger(idx)) throw err('BAD_REQUEST', '步骤号不合法');
    return { ok: true, data: { plan: retryStep(p(req).id, idx, s.sub) } };
  });

  app.post('/api/agent/plans/:id/steps/:idx/skip', async (req) => {
    const s = requireUser(req);
    const idx = Number(p(req).idx);
    if (!Number.isInteger(idx)) throw err('BAD_REQUEST', '步骤号不合法');
    return { ok: true, data: { plan: skipStep(p(req).id, idx, s.sub) } };
  });

  /** 前端执行完客户端步骤后的回执 */
  app.post('/api/agent/receipt', async (req) => {
    requireUser(req);
    const b = (req.body ?? {}) as { requestId?: string; ok?: boolean; error?: string };
    if (!b.requestId) throw err('BAD_REQUEST', '缺少 requestId');
    const hit = reportClientReceipt(b.requestId, b.ok !== false, b.error);
    return { ok: true, data: { accepted: hit } };
  });
}
