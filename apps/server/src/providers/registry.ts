import type { Capability, ProviderRequest, ProviderResult } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { mockProvider } from './mock';
import { openaiImagesProvider } from './openai_images';
import { seedreamProvider } from './seedream';
import { wanxProvider } from './wanx';
import { UpstreamError, type GenerateOptions, type ImageProvider } from './types';
import { log } from '../lib/log';

const ALL: ImageProvider[] = [seedreamProvider, wanxProvider, openaiImagesProvider, mockProvider];

export function providerById(id: string): ImageProvider | undefined {
  return ALL.find((p) => p.id === id);
}

/** 给 /api/health 与管理员页用：一眼看出哪些上游真的可用 */
export function providerStatus() {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    available: p.available,
    capabilities: p.capabilities,
  }));
}

/** 按 PROVIDER_PRIORITY 顺序挑出支持该能力且已配置的 provider */
export function chainFor(cap: Capability): ImageProvider[] {
  return config.providerPriority
    .map((id) => providerById(id.trim()))
    .filter((p): p is ImageProvider => Boolean(p && p.available && p.capabilities.includes(cap)));
}

/**
 * 当前配置下**真的能服务**的能力集合。规划器与计划校验器都拿它过滤，
 * 因为"模型选了一个没人做得到的工具"应该在它看得见之前就被排除，
 * 而不是等任务跑起来才报"没有可用模型"。
 * 能力全集从各家 provider 声明里取，不另写一份清单，免得两边漂开。
 */
export function availableCapabilities(): string[] {
  const universe = new Set<Capability>();
  for (const p of ALL) for (const c of p.capabilities) universe.add(c);
  return [...universe].filter((c) => chainFor(c).length > 0);
}

/**
 * 依次尝试，失败降级；全部失败才抛错。
 * 不会偷偷回退到 mock —— mock 必须显式写在 PROVIDER_PRIORITY 里，
 * 否则用户会误以为拿到的是真实模型效果。
 */
export async function generate(
  cap: Capability,
  req: ProviderRequest,
  onProgress?: (p: number) => void,
  opts?: GenerateOptions,
): Promise<ProviderResult> {
  const chain = chainFor(cap);
  if (!chain.length) {
    throw err(
      'PROVIDER_UNAVAILABLE',
      `没有可用的模型支持「${cap}」。检查 PROVIDER_PRIORITY（当前：${config.PROVIDER_PRIORITY}）与对应 API Key`,
    );
  }
  const failures: string[] = [];
  for (const p of chain) {
    try {
      const r = await p.generate(req, onProgress, opts);
      if (chain.length > 1 && failures.length) {
        log.warn('前面失败的 provider 全被跳过，这次由它成功', { provider: p.id, failed: failures.join(' / ') });
      }
      return r;
    } catch (e) {
      const msg = e instanceof UpstreamError ? `${p.id}: ${e.kind} ${e.message}` : `${p.id}: ${String(e)}`;
      failures.push(msg);
      log.warn('上游失败，降级到下一个 provider', { detail: msg });
      if (e instanceof UpstreamError && e.kind === 'timeout') continue;
    }
  }
  const last = failures[failures.length - 1] ?? '未知错误';
  throw err(
    /timeout/i.test(last) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILED',
    `模型调用失败（${chain.map((c) => c.label).join(' → ')}）：${last.slice(0, 160)}`,
    failures,
  );
}
