import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { err } from '../lib/errors';
import { intField } from '../lib/parse';
import { providerStatus } from '../providers/registry';
import { getQuota } from '../services/quota';
import { globalCostToday } from '../store/usage';
import { createInvites, listInvites, listUsers, updateUserQuota } from '../store/users';
import { db } from '../db/index';
import { worker } from '../queue/index';
import { p, requireAdmin } from './_http';

export function adminRoutes(app: FastifyInstance): void {
  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const totals = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM tasks) AS tasks,
          (SELECT COUNT(*) FROM tasks WHERE status = 'failed') AS failedTasks,
          (SELECT COUNT(*) FROM images) AS images,
          (SELECT COUNT(*) FROM invites WHERE used_by IS NULL) AS freeInvites`,
      )
      .get() as Record<string, number | bigint>;
    return {
      ok: true,
      data: {
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])),
        costTodayYuan: Math.round(globalCostToday() * 100) / 100,
        budgetYuan: config.DAILY_BUDGET_YUAN,
        worker: worker.stats,
        providers: providerStatus(),
        moderation: config.MODERATION,
      },
    };
  });

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const users = listUsers().map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      quotaPerDay: u.quota_per_day,
      quota: getQuota(u.id),
      createdAt: u.created_at,
    }));
    return { ok: true, data: { users } };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as { quotaPerDay?: number };
    const q = Number(body.quotaPerDay);
    if (!Number.isInteger(q) || q < 0 || q > 5000) {
      throw err('BAD_REQUEST', 'quotaPerDay 需要是 0-5000 的整数');
    }
    updateUserQuota(p(req).id, q);
    return { ok: true, data: { updated: true } };
  });

  app.get('/api/admin/invites', async (req) => {
    requireAdmin(req);
    return { ok: true, data: { invites: listInvites() } };
  });

  app.post('/api/admin/invites', async (req) => {
    const s = requireAdmin(req);
    const body = (req.body ?? {}) as { count?: unknown; validDays?: unknown };
    const n = intField(body.count, { name: '数量', default: 1, min: 1, max: 20 });
    // 0 = 不限期。给期限是默认而不是例外：码是发出去的，没人回收就一直躺在库里
    const validDays = intField(body.validDays, { name: '有效期', default: 30, min: 0, max: 3650 });
    return { ok: true, data: { codes: createInvites(s.sub, n, validDays), validDays } };
  });
}
