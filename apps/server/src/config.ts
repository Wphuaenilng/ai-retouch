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
  /**
   * 反向代理信任范围。不开的话 req.ip 永远是代理的 IP，登录/上传限流就会
   * 全体用户共用一个桶（一个人就能把所有人锁在门外）。
   * 只接受 IP / CIDR 列表（Fastify 的 proxy-addr.compile 不认 'private' 这类关键字），
   * 默认是本机回环 + 常见内网段（Docker  bridge 网络就落在这里），公网传来的
   * X-Forwarded-For 一律不信。裸跑不接代理时设成 false。
   */
  TRUST_PROXY: z.string().default('127.0.0.1, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16'),
  /**
   * 上游模型回拉图片时用的公网地址。**当前没有代码读它**（所有 provider 走 dataURL），
   * 保留是因为接真上游时一定会用到，且 compose 把必填。
   * 别把它当开关使 —— 见 05 的 D28：上一个"留着但没人读"的配置是 IMAGE_FALLBACK_TO_MOCK。
   */
  PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:8787'),

  /** Provider 优先级，逗号分隔；未配 key 的会被自动跳过 */
  PROVIDER_PRIORITY: z.string().default('mock'),

  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  ARK_IMAGE_MODEL: z.string().default('doubao-seedream-4-5-250828'),

  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().default('https://dashscope.aliyuncs.com/api/v1'),
  WANX_EDIT_MODEL: z.string().default('wan2.6-image'),
  WANX_T2I_MODEL: z.string().default('wan2.6-t2i'),

  /**
   * OpenAI 兼容端点（官方或中转站）的 gpt-image。**只服务 text2image**，
   * 编辑/局部重绘接不动 —— 原因见 providers/openai_images.ts 顶部。
   * 模型名以端点 /models 列出的为准，各家叫法不统一。
   */
  OPENAI_IMAGES_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_IMAGES_API_KEY: z.string().optional(),
  OPENAI_IMAGES_MODEL: z.string().default('gpt-image-2'),
  OPENAI_IMAGES_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).default('auto'),
  /** 元/张。上游按 token 计费，这里给的是熔断用的估价值 */
  OPENAI_IMAGES_PRICE_YUAN: z.coerce.number().default(0.35),

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
  /** 一次上传请求的总字节上限（原图+编辑副本+缩略图+遮罩 会一起发过来） */
  MAX_UPLOAD_TOTAL_MB: z.coerce.number().default(60),
  EDIT_COPY_MAX_EDGE: z.coerce.number().int().default(2048),
  THUMB_MAX_EDGE: z.coerce.number().int().default(256),

  /** 内容审核：none 关闭；qwen-vl 用多模态模型做一次粗筛 */
  MODERATION: z.enum(['none', 'qwen-vl']).default('none'),
  /**
   * 提示词关键词表，逗号分隔。给了就**整表替换**默认名单（要保留默认项就自己抄一遍），
   * 因为"放宽"和"追加"用一份配置表达不了；留空 = 用默认名单。
   */
  MODERATION_BLOCK_WORDS: z.string().default(''),

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

/**
 * 测试进程绝不允许碰默认路径 —— 那就是开发机上的 data/retouch.db，真实数据。
 * 踩过一次：某个测试文件只 import 了服务层，就悄悄打开了活库，跑并发时报
 * "database is locked"，更糟的情况是把断言写进真数据里。
 */
if (raw.NODE_ENV === 'test' && (!process.env.SQLITE_PATH || !process.env.DATA_DIR)) {
  throw new Error('测试必须显式设 SQLITE_PATH 与 DATA_DIR（指向临时目录），否则会和开发机的真实库打架');
}

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
  maxUploadTotalBytes: Math.round(raw.MAX_UPLOAD_TOTAL_MB * 1024 * 1024),
  /** 有 key 才认为该 provider 可用 */
  availableProviders: {
    mock: true,
    seedream: Boolean(raw.ARK_API_KEY),
    wanx: Boolean(raw.DASHSCOPE_API_KEY),
  },
} as const;

export type Config = typeof config;
