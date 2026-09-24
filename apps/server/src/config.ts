import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/server/src -> 仓库根 */
export const ROOT = resolve(HERE, '../../..');

const abs = (p: string) => (isAbsolute(p) ? p : resolve(ROOT, p));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8787),

  /** 数据目录：图片落盘位置 */
  DATA_DIR: z.string().default('data'),
  SQLITE_PATH: z.string().default('data/retouch.db'),
  /** 预留：接 Postgres 时使用，当前实现走 SQLite */
  DATABASE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** 签名图片外链用；上游模型要求公网可访问时必须配成真实域名 */
  PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8787'),

  /** Provider 优先级，逗号分隔；未配 key 的会被自动跳过 */
  PROVIDER_PRIORITY: z.string().default('mock'),
  IMAGE_FALLBACK_TO_MOCK: z.enum(['true', 'false']).default('true'),

  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  ARK_IMAGE_MODEL: z.string().default('doubao-seedream-4-5-250828'),

  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().default('https://dashscope.aliyuncs.com/api/v1'),
  WANX_EDIT_MODEL: z.string().default('wan2.6-image'),
  WANX_T2I_MODEL: z.string().default('wan2.6-t2i'),

  /** 规划模型：mock = 规则式，离线也能跑通 Agent 全链路 */
  LLM_PLAN_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  LLM_BASE_URL: z.string().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('qwen-plus'),

  PER_USER_DAILY_CALLS: z.coerce.number().int().positive().default(30),
  DAILY_BUDGET_YUAN: z.coerce.number().default(200),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  TASK_TIMEOUT_MS: z.coerce.number().int().default(120_000),
  TASK_MAX_RETRY: z.coerce.number().int().min(0).max(3).default(1),
  CLIENT_STEP_TIMEOUT_MS: z.coerce.number().int().default(60_000),

  MAX_UPLOAD_MB: z.coerce.number().default(20),
  EDIT_COPY_MAX_EDGE: z.coerce.number().int().default(2048),
  THUMB_MAX_EDGE: z.coerce.number().int().default(256),

  /** 内容审核：none 关闭；qwen-vl 用多模态模型做一次粗筛 */
  MODERATION: z.enum(['none', 'qwen-vl']).default('none'),

  /** 首次启动时自动创建的管理员与邀请码（留空则不创建） */
  BOOTSTRAP_ADMIN_USERNAME: z.string().default(''),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().default(''),
  BOOTSTRAP_INVITE_CODE: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] 环境变量校验失败：');
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  ...raw,
  DATA_DIR: abs(raw.DATA_DIR),
  SQLITE_PATH: abs(raw.SQLITE_PATH),
  isProd: raw.NODE_ENV === 'production',
  cookieSecure: raw.COOKIE_SECURE === 'true',
  providerPriority: raw.PROVIDER_PRIORITY.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxUploadBytes: Math.round(raw.MAX_UPLOAD_MB * 1024 * 1024),
  /** 有 key 才认为该 provider 可用 */
  availableProviders: {
    mock: true,
    seedream: Boolean(raw.ARK_API_KEY),
    wanx: Boolean(raw.DASHSCOPE_API_KEY),
  },
} as const;

export type Config = typeof config;
