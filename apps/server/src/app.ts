import { existsSync, readFileSync, statSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { extname, join, resolve, sep } from 'node:path';
import { config, ROOT } from './config';
import { decodeParam } from './lib/parse';
import { AppError, err, normalizeError } from './lib/errors';
import { agentRoutes } from './routes/agent';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { documentRoutes } from './routes/documents';
import { eventRoutes } from './routes/events';
import { imageRoutes } from './routes/images';
import { taskRoutes } from './routes/tasks';
import { uploadRoutes } from './routes/uploads';
import { authPreHandler } from './routes/_http';
import { providerStatus } from './providers/registry';
import { migrate } from './db/migrate';
import { seed } from './db/seed';
import { worker } from './queue/index';
import { hub } from './lib/sse';

const WEB_DIST = resolve(ROOT, 'apps/web/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** 同源校验：带 Cookie 的写操作必须来自同一个 host，防 CSRF */
function originGuard(origin: string | undefined, host: string | undefined): void {
  if (!origin) return;
  try {
    const o = new URL(origin).host;
    if (o !== host) throw err('FORBIDDEN', '跨站请求被拒绝');
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw err('BAD_REQUEST', 'Origin 头不合法');
  }
}

/** 只信列出的代理范围内的 X-Forwarded-For；'false'/空 = 谁都不信（裸跑时用） */
function trustProxySetting(): string | boolean {
  const raw = config.TRUST_PROXY.trim();
  if (!raw || raw.toLowerCase() === 'false') return false;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

export async function buildApp(): Promise<FastifyInstance> {
  migrate();
  seed();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? (config.isProd ? 'warn' : 'info') },
    bodyLimit: config.maxUploadTotalBytes,
    // 不开 trustProxy，req.ip 恒为代理地址，登录/上传限流就会全员共用一个桶
    trustProxy: trustProxySetting(),
  });

  // SSE 的超时保护在 index.ts 里 listen 之后统一关掉（Node 默认 requestTimeout=300s 会掐断长连接）
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 4 },
    attachFieldsToBody: false,
  });

  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) originGuard(req.headers.origin, req.headers.host);
  });
  app.addHook('preHandler', authPreHandler);

  app.setErrorHandler((e, req, reply) => {
    const code = (e as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'PART_TOO_LARGE') {
      return reply.status(413).send({ ok: false, error: { code: 'FILE_TOO_LARGE', message: `单张最大 ${config.MAX_UPLOAD_MB}MB` } });
    }
    // Fastify 自己的请求解析错误带 statusCode，别一律按 500 处理
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({ ok: false, error: { code: 'BAD_REQUEST', message: (e as Error).message } });
    }
    const ne = e instanceof AppError ? e : normalizeError(e);
    if (ne.code === 'INTERNAL') req.log.error(e);
    return reply.status(ne.status).send({ ok: false, error: { code: ne.code, message: ne.message, details: ne.details } });
  });

  app.get('/api/health', async () => ({
    ok: true,
    data: {
      status: 'up',
      env: config.NODE_ENV,
      worker: worker.stats,
      sseClients: hub.connectionCount,
      providers: providerStatus(),
      planner: config.LLM_PLAN_PROVIDER,
      moderation: config.MODERATION,
    },
  }));

  authRoutes(app);
  uploadRoutes(app);
  imageRoutes(app);
  taskRoutes(app);
  documentRoutes(app);
  agentRoutes(app);
  eventRoutes(app);
  adminRoutes(app);

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: `没有这个接口：${req.method} ${req.url}` } });
    }
    return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } });
  });

  // 生产：同一个进程把前端构建产物也发出去（开发期用 Vite dev server + proxy）
  if (existsSync(WEB_DIST) && statSync(WEB_DIST).isDirectory()) {
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api/')) throw err('NOT_FOUND', '接口不存在');
      const rel = decodeParam(req.url.split('?')[0]);
      const candidate = resolve(WEB_DIST, '.' + (rel === '/' ? '/index.html' : rel));
      if (candidate !== WEB_DIST && !candidate.startsWith(WEB_DIST + sep)) throw err('FORBIDDEN', '非法路径');
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        reply.header('content-type', MIME[extname(candidate)] ?? 'application/octet-stream');
        // 只有带内容哈希的 assets 才配 immutable；html 必须每次回源，
        // 否则发新版后老用户拿到的还是旧 hash 的入口，永远更新不到
        reply.header(
          'cache-control',
          extname(candidate) === '.html' || !candidate.includes(`${sep}assets${sep}`) ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
        return reply.send(readFileSync(candidate));
      }
      // SPA 回退
      reply.header('content-type', MIME['.html']);
      reply.header('cache-control', 'no-cache');
      return reply.send(readFileSync(join(WEB_DIST, 'index.html')));
    });
  }

  return app;
}
