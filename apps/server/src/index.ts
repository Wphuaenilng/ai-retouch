import { buildApp } from './app';
import { config } from './config';
import { closeDb } from './db/index';
import { worker } from './queue/index';

async function main(): Promise<void> {
  const app = await buildApp();
  worker.start();

  await app.listen({ host: config.HOST, port: config.PORT });

  // Node 的默认 requestTimeout(300s) 会掐断 SSE 长连接，listen 后关掉
  app.server.requestTimeout = 0;
  app.server.headersTimeout = 65_000;
  app.server.timeout = 0;

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
