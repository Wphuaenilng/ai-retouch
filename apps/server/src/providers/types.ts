import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';

/** 任务级控制：worker 超时或进程退出时，适配器要真的把上游请求掐掉，而不是让钱花完再丢结果 */
export interface GenerateOptions {
  signal?: AbortSignal;
}

export interface ImageProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Capability[];
  /** 没配 key 就是 false，注册表会自动跳过 */
  readonly available: boolean;
  /** 元/张，用于成本统计与配额 */
  priceFor(cap: Capability): number;
  generate(req: ProviderRequest, onProgress?: (p: number) => void, opts?: GenerateOptions): Promise<ProviderResult>;
}

export type UpstreamKind = 'timeout' | 'http' | 'network' | 'bad_response';

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamKind,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
