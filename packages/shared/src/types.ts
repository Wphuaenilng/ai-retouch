/**
 * 全项目共享契约层 —— 服务端与前端都从这里取类型，任何一侧不得私自扩展。
 * 改这个文件等于改接口协议，要同时检查两端。
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * 能力与状态
 * ------------------------------------------------------------------ */

/** Provider 需要实现的能力标签 */
export type Capability = 'text2image' | 'edit' | 'inpaint' | 'outpaint' | 'upscale' | 'segment' | 'portrait' | 'textRender';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type ToolExecutor = 'server' | 'client';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled';

export type PlanStatus = 'proposed' | 'approved' | 'running' | 'done' | 'failed' | 'canceled';

/* ------------------------------------------------------------------ *
 * Provider 协议（各家模型 API 的差异必须被封死在适配器内）
 * ------------------------------------------------------------------ */

export interface ImageRef {
  /** 服务端可访问的 URL（含本服务自己的 /api/images/:id） */
  url?: string;
  /** dataURL 或纯 base64，由适配器按各家要求转换 */
  base64?: string;
  mime?: string;
}

export interface ProviderRequest {
  capability: Capability;
  prompt?: string;
  negativePrompt?: string;
  /** 输入图，顺序即语义顺序（如 merge 的第一张是底图） */
  images: ImageRef[];
  /** 编辑区遮罩：白=要改，黑=保留 */
  mask?: ImageRef;
  size?: { width: number; height: number };
  count?: number;
  /** 上游幂等键，用我们的 taskId，避免重试重复计费 */
  idempotencyKey?: string;
}

export interface ProviderImage {
  url?: string;
  base64?: string;
  mime?: string;
  width?: number;
  height?: number;
}

export interface ProviderResult {
  images: ProviderImage[];
  /** 实际花费（元），用于配额与成本统计 */
  costYuan: number;
  provider: string;
  model: string;
  raw?: unknown;
}

/* ------------------------------------------------------------------ *
 * 工具注册表元信息
 * ------------------------------------------------------------------ */

/** 工具箱表单的字段描述 —— UI 由注册表生成，不再各写一份表单 */
export interface FieldSpec {
  key: string;
  label: string;
  kind: 'textarea' | 'select' | 'slider' | 'color' | 'toggle' | 'imageRef' | 'number';
  placeholder?: string;
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** 该字段依赖当前选区（没有选区时表单给出提示而不是静默提交失败） */
  needsSelection?: boolean;
  hint?: string;
}

export interface ToolDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** UI 文案 */
  title: string;
  group: 'ai' | 'local';
  executor: ToolExecutor;
  capability?: Capability;
  /** 与设计稿图标 id 对应，如 i-cut */
  icon: string;
  priority: 0 | 1 | 2;
  needsImage: boolean;
  needsMask?: boolean;
  /** 结果落地形态：新图 / 图层变更 / 无（导出） */
  produces: 'image' | 'layers' | 'none';
  /** 参考单价（元），仅用于提交前的区间提示。
   *  一个工具内部调用几次上游就要累加几次（split_layers = segment + edit）；
   *  真实记账以 provider 返回的 costYuan 为准，别拿这个数当账本。 */
  costYuan: number;
  input: T;
  /** 工具箱表单字段 */
  fields: FieldSpec[];
  /** 喂给规划模型的说明：什么时候用它 */
  agentHint: string;
  /** 喂给规划模型的参数摘要（人写的，比 JSON Schema 更省 token 也更稳） */
  paramsHint: string;
}

/* ------------------------------------------------------------------ *
 * DTO —— REST 响应与 SSE 事件的载荷
 * ------------------------------------------------------------------ */

export interface TaskDTO {
  id: string;
  tool: string;
  title: string;
  status: TaskStatus;
  progress: number;
  documentId?: string | null;
  imageId?: string | null;
  resultImageId?: string | null;
  provider?: string | null;
  model?: string | null;
  costYuan: number;
  error?: string | null;
  errorCode?: string | null;
  /** 工具的结构化产出（如 split_layers 的 layers）；前端按 tool 解读 */
  output?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface PlanStepDTO {
  idx: number;
  tool: string;
  title: string;
  executor: ToolExecutor;
  params: Record<string, unknown>;
  deps: number[];
  reason?: string;
  status: StepStatus;
  taskId?: string | null;
  error?: string | null;
  costYuan?: number;
  durationMs?: number;
}

export interface PlanDTO {
  id: string;
  documentId: string;
  userMessage: string;
  status: PlanStatus;
  planner: string;
  steps: PlanStepDTO[];
  costYuan: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ImageDTO {
  id: string;
  kind: 'original' | 'edit' | 'result' | 'thumb' | 'mask';
  width: number;
  height: number;
  bytes: number;
  mime: string;
  url: string;
  thumbUrl?: string;
  createdAt: string;
}

export interface QuotaDTO {
  limit: number;
  used: number;
  remaining: number;
  costTodayYuan: number;
  /** 下一次日切的绝对时刻（服务器本地 0 点）。别说"明天 0 点"，那只对同时区的人成立 */
  resetsAt: string;
}

export interface MeDTO {
  id: string;
  username: string;
  role: 'user' | 'admin';
  quota: QuotaDTO;
  createdAt: string;
  /** 隐私告知确认时间；null 表示还没确认过，前端在首次上传前拦一道 */
  consentAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Agent 计划：模型产出的原始草稿 与 校验后的执行序
 * ------------------------------------------------------------------ */

export const planStepDraftSchema = z.object({
  id: z.string().min(1).max(24),
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  deps: z.array(z.string()).default([]),
  reason: z.string().max(200).optional(),
});

export const planDraftSchema = z.object({
  summary: z.string().max(300).optional(),
  steps: z.array(planStepDraftSchema).min(1).max(6),
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanStepDraft = z.infer<typeof planStepDraftSchema>;

/** 校验器产出：已排序、参数已钳制的可执行步骤 */
export interface ValidatedStep {
  idx: number;
  tool: string;
  params: Record<string, unknown>;
  deps: number[];
  reason?: string;
  executor: ToolExecutor;
  title: string;
}

/* ------------------------------------------------------------------ *
 * SSE 事件
 * ------------------------------------------------------------------ */

export type ServerEvent =
  | { type: 'task.queued'; task: TaskDTO }
  | { type: 'task.running'; task: TaskDTO }
  | { type: 'task.progress'; task: TaskDTO; progress: number }
  | { type: 'task.succeeded'; task: TaskDTO }
  | { type: 'task.failed'; task: TaskDTO }
  | { type: 'plan.created'; plan: PlanDTO }
  | { type: 'plan.updated'; plan: PlanDTO }
  | { type: 'quota.changed'; quota: QuotaDTO }
  /** 前端工具由 Agent 下发指令，画布执行后回执 */
  | {
      type: 'agent.client_command';
      planId: string;
      stepIdx: number;
      tool: string;
      params: Record<string, unknown>;
      requestId: string;
    };

export const EVENT_TYPES = [
  'task.queued',
  'task.running',
  'task.progress',
  'task.succeeded',
  'task.failed',
  'plan.created',
  'plan.updated',
  'quota.changed',
  'agent.client_command',
] as const;

/* ------------------------------------------------------------------ *
 * 稳定错误码 —— 前端按码给文案，不得解析 message 文本
 * ------------------------------------------------------------------ */

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVITE_INVALID',
  'USERNAME_TAKEN',
  'BAD_CREDENTIALS',
  'QUOTA_EXCEEDED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_UNSUPPORTED',
  'MODERATION_REJECTED',
  'MODERATION_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_FAILED',
  'PROVIDER_TIMEOUT',
  'TOOL_UNKNOWN',
  'TOOL_PARAMS_INVALID',
  'PLAN_CYCLE',
  'PLAN_EMPTY',
  'PLAN_NOT_APPROVABLE',
  'NEEDS_IMAGE',
  'NEEDS_MASK',
  'CLIENT_TIMEOUT',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** 可选的结构化补充，如参数校验明细 */
  details?: unknown;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/* ------------------------------------------------------------------ *
 * 文档（画布）JSON —— 存 documents.canvas
 * ------------------------------------------------------------------ */

export interface DocLayer {
  id: string;
  // 没有 text 图层：加文字不在当前工具集里，留着只会被 zod 静默剥掉
  kind: 'base' | 'subject' | 'background' | 'adjust' | 'mask';
  name: string;
  imageId?: string | null;
  visible: boolean;
  opacity: number;
  blend: 'normal' | 'multiply' | 'screen';
  transform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
  /** kind=adjust 时的调色参数，等价于 adjust 工具的 params */
  adjust?: Record<string, number>;
}

export interface DocCanvas {
  width: number;
  height: number;
  sourceImageId: string | null;
  layers: DocLayer[];
  activeLayerId?: string | null;
  /** 前端选区/遮罩的元信息，刷新后可恢复 */
  selection?: { kind: 'rect' | 'lasso' | 'brush'; maskImageId?: string | null } | null;
}

export interface DocumentDTO {
  id: string;
  title: string;
  canvas: DocCanvas;
  thumbUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastTask?: TaskDTO | null;
}
