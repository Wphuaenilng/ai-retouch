import { getTool, validateToolParams, type PlanDraft, type ValidatedStep } from '@retouch/shared';
import { AppError, err } from '../lib/errors';

export interface PlanFacts {
  /** 当前画面主图 id */
  currentImageId: string | null;
  /** 画布上是否已有选区遮罩 */
  hasSelection: boolean;
  maskImageId: string | null;
  layerIds: string[];
  hasMultipleImages: boolean;
}

export type ValidateResult = { ok: true; steps: ValidatedStep[]; warnings: string[] } | { ok: false; errors: string[] };

/**
 * 计划校验器 —— 纯代码，不碰模型也不碰数据库，是整个 Agent 里唯一可完全单测的部分。
 * 顺序：工具白名单 → 参数 schema → 事实补全（imageId/mask）→ 依赖清洗 → 环检测 → 拓扑排序
 */
export function validatePlan(draft: PlanDraft, facts: PlanFacts): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const kept = draft.steps.filter((s) => {
    if (!getTool(s.tool)) {
      errors.push(`不存在的工具：${s.tool}`);
      return false;
    }
    return true;
  });
  if (!kept.length) return { ok: false, errors: errors.length ? errors : ['计划里没有任何可用步骤'] };

  const idToIdx = new Map(kept.map((s, i) => [s.id, i]));
  const steps: ValidatedStep[] = [];

  kept.forEach((s, i) => {
    const tool = getTool(s.tool)!;
    const params: Record<string, unknown> = { ...s.params };

    // 事实补全：模型经常漏写 imageId
    if (tool.needsImage && !params.imageId) {
      if (facts.currentImageId) {
        params.imageId = facts.currentImageId;
        warnings.push(`${tool.title}：已自动指向当前图片`);
      } else {
        errors.push(`${tool.title} 需要一张图，但当前文档还没有图片`);
        return;
      }
    }
    if (tool.needsMask) {
      if (!params.maskImageId && facts.maskImageId) {
        params.maskImageId = facts.maskImageId;
        warnings.push(`${tool.title}：已使用画布上的选区`);
      } else if (!params.maskImageId) {
        errors.push(`${tool.title} 需要先在画布上涂抹或框选区域`);
        return;
      }
    }
    if (params.layerId && typeof params.layerId === 'string' && !facts.layerIds.includes(params.layerId)) {
      delete params.layerId;
      warnings.push(`${tool.title}：指定的图层不存在，已改为作用于当前图层`);
    }

    const checked = validateToolParams(s.tool, params);
    if (!checked.ok) {
      errors.push(`${tool.title} 参数不合法：${checked.issues.join('；')}`);
      return;
    }

    const deps = s.deps
      .map((d) => idToIdx.get(d))
      .filter((x): x is number => typeof x === 'number' && x !== i);

    steps.push({
      idx: i,
      tool: s.tool,
      params: checked.value,
      deps: [...new Set(deps)],
      reason: s.reason,
      executor: tool.executor,
      title: tool.title,
    });
  });

  if (errors.length) return { ok: false, errors };

  // 环检测（DFS 三色标记）
  const state = new Map<number, 0 | 1 | 2>();
  const visit = (n: number, path: number[]): void => {
    const st = state.get(n) ?? 0;
    if (st === 1) throw err('PLAN_CYCLE', `步骤依赖成环：${[...path, n].join(' → ')}`);
    if (st === 2) return;
    state.set(n, 1);
    for (const d of steps[n]!.deps) visit(d, [...path, n]);
    state.set(n, 2);
  };
  try {
    steps.forEach((_, i) => visit(i, []));
  } catch (e) {
    if (e instanceof AppError && e.code === 'PLAN_CYCLE') return { ok: false, errors: [e.message] };
    throw e;
  }

  // 拓扑排序：依赖在前，同层保持模型给出的顺序
  const order: ValidatedStep[] = [];
  const done = new Set<number>();
  let guard = 0;
  while (order.length < steps.length && guard < steps.length * steps.length) {
    guard += 1;
    for (const s of steps) {
      if (done.has(s.idx)) continue;
      if (s.deps.every((d) => done.has(d))) {
        done.add(s.idx);
        order.push(s);
      }
    }
  }
  if (order.length !== steps.length) return { ok: false, errors: ['依赖无法满足，可能存在自依赖步骤'] };

  // 重排后必须把 deps 的旧下标映射到新下标，否则执行器会等错步骤
  const remap = new Map<number, number>();
  order.forEach((s, i) => remap.set(s.idx, i));

  return {
    ok: true,
    steps: order.map((s, i) => ({
      ...s,
      idx: i,
      deps: [...new Set(s.deps.map((d) => remap.get(d) ?? d).filter((d) => d !== i))],
    })),
    warnings,
  };
}
