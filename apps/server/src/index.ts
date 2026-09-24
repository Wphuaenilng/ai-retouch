import { buildApp } from './app';
import { config } from './config';
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

  const shutdown = (signal: string) => {
    app.log.info(`${signal}，正在退出…`);
    worker.stop();
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[fatal] 启动失败', e);
  process.exit(1);
});
