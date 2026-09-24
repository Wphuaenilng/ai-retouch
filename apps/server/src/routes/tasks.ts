import type { FastifyInstance } from 'fastify';
import { getTool, type TaskStatus } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { providerStatus } from '../providers/registry';
import { cancelTask, listUserTasks, requireTask, retryTask, submitTask, toTaskDTO } from '../services/tasks';
import { findTask } from '../store/tasks';
import { p, limit, requireUser } from './_http';

const TERMINAL: TaskStatus[] = ['succeeded', 'failed', 'canceled'];

export function taskRoutes(app: FastifyInstance): void {
  app.post('/api/tasks', async (req) => {
    const s = requireUser(req);
    limit(req, 'task', 40, 60_000);
    const body = (req.body ?? {}) as { tool?: string; params?: Record<string, unknown>; documentId?: string };
    if (!body.tool) throw err('BAD_REQUEST', '缺少 tool');
    const tool = getTool(body.tool);
    if (!tool) throw err('TOOL_UNKNOWN', `没有这个工具：${body.tool}`);
    if (tool.executor !== 'server') throw err('BAD_REQUEST', `${tool.title} 在浏览器本地执行`);
    if (tool.priority > 1) throw err('BAD_REQUEST', `${tool.title} 尚未开放`);

    const { task } = submitTask({
      userId: s.sub,
      tool: body.tool,
      params: body.params ?? {},
      documentId: body.documentId ?? null,
    });
    return { ok: true, data: { task } };
  });

  app.get('/api/tasks', async (req) => {
    const s = requireUser(req);
    const q = req.query as { status?: string; limit?: string; cursor?: string };
    const status = q.status ? (q.status.split(',').filter(Boolean) as TaskStatus[]) : undefined;
    return { ok: true, data: { tasks: listUserTasks(s.sub, { status, limit: Number(q.limit ?? 30), before: q.cursor }) } };
  });

  app.get('/api/tasks/active', async (req) => {
    const s = requireUser(req);
    const all = listUserTasks(s.sub, { limit: 50 }).filter((t) => !TERMINAL.includes(t.status));
    return { ok: true, data: { tasks: all } };
  });

  app.get('/api/tasks/:id', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { task: toTaskDTO(requireTask(p(req).id, s.sub)) } };
  });

  app.post('/api/tasks/:id/retry', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { task: retryTask(p(req).id, s.sub) } };
  });

  app.post('/api/tasks/:id/cancel', async (req) => {
    const s = requireUser(req);
    return { ok: true, data: { task: cancelTask(p(req).id, s.sub) } };
  });

  /** 前端刷新后可恢复：把当前进行中的任务原样列出来（SSE 断线的兜底） */
  app.get('/api/tasks/:id/snapshot', async (req) => {
    const s = requireUser(req);
    const row = findTask(p(req).id);
    if (!row || row.user_id !== s.sub) throw err('NOT_FOUND', '任务不存在');
    return { ok: true, data: { task: toTaskDTO(row), worker: { concurrency: config.WORKER_CONCURRENCY }, providers: providerStatus() } };
  });
}
