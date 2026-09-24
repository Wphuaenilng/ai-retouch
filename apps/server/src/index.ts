import { buildApp } from './app';
import { config } from './config';
import { closeDb } from './db/index';
import { worker } from './queue/index';

async function main(): Promise<void> {
  // 开了审核却没配 key：每一次审核都会 401，成品图全被 fail-closed 挡下，
  // 表现是"所有人都出不了图"。这种配置错误要在启动时就顶回去，不要拖到运行时
  if (config.MODERATION === 'qwen-vl' && !config.LLM_API_KEY) {
    throw new Error('MODERATION=qwen-vl 但 LLM_API_KEY 为空 —— 补上 key，或者显式设 MODERATION=none');
  }

  const app = await buildApp();
  worker.start();

  await app.listen({ host: config.HOST, port: config.PORT });

  // Node 的默认 requestTimeout(300s) 会掐断 SSE 长连接，listen 后关掉
  app.server.requestTimeout = 0;
  app.server.headersTimeout = 65_000;
  app.server.timeout = 0;

  if (config.isProd && config.MODERATION === 'none') {
    app.log.warn('[moderation] MODERATION=none：上传与生成结果都不过审。要分享给别人之前建议开 qwen-vl');
  }

  app.log.info(`retouch-studio server → http://${config.HOST}:${config.PORT}  (数据目录 ${config.DATA_DIR})`);
  app.log.info(`provider 优先级：${config.providerPriority.join(' → ')}；规划器：${config.LLM_PLAN_PROVIDER}`);

  let exiting = false;
  const shutdown = (signal: string): void => {
    if (exiting) return;
    exiting = true;
    app.log.info(`${signal}，正在退出：先不再领新任务，等在飞的跑完`);
    // 留 8s：Docker 默认 10s 后才 SIGKILL。超时的任务会被下次启动回收并退还配额
    void worker
      .drainInFlight(Math.min(config.TASK_TIMEOUT_MS + 5_000, 8_000))
      .then(async (left) => {
        if (left) app.log.warn(`[queue] 仍有 ${left} 个任务没结束，交给下次启动的回收逻辑（会退配额）`);
        await app.close();
        closeDb();
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[fatal] 启动失败', e);
  process.exit(1);
});
