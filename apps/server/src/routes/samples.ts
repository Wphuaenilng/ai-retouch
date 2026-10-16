import type { FastifyInstance } from 'fastify';
import { toDTO } from '../services/images';
import { importSample, listSamples, readSample } from '../services/samples';
import { limit, p, requireUser } from './_http';

/**
 * 内置测试图：让没有照片可传的人也能立刻走完一遍"选工具 → 出图 → 对比"。
 * 三个接口都要求登录 —— 它们不是公开图床，只是首屏的脚手架。
 */
export function sampleRoutes(app: FastifyInstance): void {
  app.get('/api/samples', async (req) => {
    requireUser(req);
    return { ok: true, data: { samples: listSamples() } };
  });

  app.get('/api/samples/:id', async (req, reply) => {
    requireUser(req);
    const buf = readSample(p(req).id);
    // private 而不是 public：这三张图对所有用户都一样、也确实是公开内容，但响应是
    // 靠 Cookie 鉴权的，标 public 等于允许共享缓存在不鉴权的情况下把它端出去
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=86400');
    return reply.send(buf);
  });

  app.post('/api/samples/:id', async (req) => {
    const s = requireUser(req);
    // 导入会写一份文件到该用户目录，所以也要限：注册就能白嫖磁盘是不行的
    limit(req, 'sample', 30, 60_000);
    const row = await importSample(p(req).id, s.sub);
    return { ok: true, data: { image: toDTO(row) } };
  });
}
