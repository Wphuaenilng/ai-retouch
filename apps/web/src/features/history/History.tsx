import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskDTO } from '@retouch/shared';
import { api, errorText } from '../../lib/api';
import { Icon } from '../../ui/Icon';

type Filter = 'all' | 'succeeded' | 'failed' | 'running';

const FILTERS: { id: Filter; label: string; status?: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '在跑', status: 'queued,running' },
  { id: 'succeeded', label: '成功', status: 'succeeded' },
  { id: 'failed', label: '失败', status: 'failed' },
];

const PAGE = 30;

/** 耗时：服务端给的是 ISO 串，跨秒就显秒，避免 "0 秒" 这种看着像坏了的数 */
function dur(t: TaskDTO): string {
  if (!t.startedAt || !t.finishedAt) return '—';
  const s = (new Date(t.finishedAt).getTime() - new Date(t.startedAt).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return '—';
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

const STATUS_TEXT: Record<string, string> = {
  queued: '排队',
  running: '显影中',
  succeeded: '成功',
  failed: '失败',
  canceled: '已取消',
};

/** 结构化产出读成人话；把 output 打成一串 JSON 是给自己看的，不是给用户看的 */
function outputBrief(t: TaskDTO): string {
  const o = t.output as { imageIds?: unknown; width?: unknown; height?: unknown; layers?: unknown } | null | undefined;
  if (!o || typeof o !== 'object') return '';
  const parts: string[] = [];
  if (typeof o.width === 'number' && typeof o.height === 'number') parts.push(`${o.width}×${o.height}`);
  if (Array.isArray(o.imageIds) && o.imageIds.length > 1) parts.push(`${o.imageIds.length} 张候选`);
  if (Array.isArray(o.layers) && o.layers.length) parts.push(`拆出 ${o.layers.length} 层`);
  return parts.join(' · ');
}

export function HistoryPage(): ReactElement {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 换筛选条件时整表重置；翻旧页只追加
  const [exhausted, setExhausted] = useState(false);
  const [nonce, setNonce] = useState(0);

  const fetchPage = useCallback(
    async (before: string | null): Promise<TaskDTO[]> => {
      const q = FILTERS.find((f) => f.id === filter);
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (q?.status) qs.set('status', q.status);
      if (before) qs.set('cursor', before);
      const r = await api.get<{ tasks: TaskDTO[] }>(`/api/tasks?${qs.toString()}`);
      return r.tasks;
    },
    [filter],
  );

  useEffect(() => {
    let live = true;
    setLoaded(false);
    setTasks([]);
    setExhausted(false);
    void fetchPage(null)
      .then((ts) => {
        if (!live) return;
        setTasks(ts);
        setError('');
        if (ts.length < PAGE) setExhausted(true);
      })
      .catch((e) => live && setError(errorText(e)))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [fetchPage, nonce]);

  const more = async (): Promise<void> => {
    const oldest = tasks.at(-1)?.createdAt;
    if (!oldest || exhausted || loadingMore) return;
    setLoadingMore(true);
    try {
      const ts = await fetchPage(oldest);
      // 同一批里可能混进已经看过的（服务端按 created_at 排，光标是"早于此"）
      const seen = new Set(tasks.map((t) => t.id));
      const fresh = ts.filter((t) => !seen.has(t.id));
      setTasks((cur) => [...cur, ...fresh]);
      if (ts.length < PAGE) setExhausted(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const totals = useMemo(
    () => ({
      cost: tasks.reduce((a, t) => a + (t.costYuan || 0), 0),
      failed: tasks.filter((t) => t.status === 'failed').length,
    }),
    [tasks],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="l">
          <span className="mark" />
          <span className="docname">记录</span>
          <span className="save mono">
            {tasks.length} 条 · 累计 ¥{totals.cost.toFixed(2)}
            {totals.failed ? ` · 失败 ${totals.failed}` : ''}
          </span>
        </div>
        <div className="c" />
        <div className="r">
          <button className="btn ghost" onClick={() => void nav('/studio')}>
            <Icon name="i-left" className="ic sm" />
            回工具箱
          </button>
        </div>
      </header>

      <div className="stage" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div className="seg" role="group" aria-label="按状态筛选" style={{ maxWidth: 360 }}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="banner warn">
            <span>读不出记录：{error}</span>
            <span className="sp" />
            <button className="btn ghost" onClick={() => setNonce((n) => n + 1)}>
              <Icon name="i-retry" className="ic sm" />
              重试
            </button>
          </div>
        )}
        {!loaded && !error && <div className="stage-empty">正在读取记录…</div>}
        {loaded && !error && !tasks.length && (
          <div className="stage-empty">
            <div>{filter === 'all' ? '还没有跑过任何任务。' : '这个筛选下没有记录。'}</div>
            <button className="btn primary" onClick={() => void nav('/studio')}>
              去修一张
            </button>
          </div>
        )}

        {tasks.map((t) => {
          const bad = t.status === 'failed';
          const brief = bad ? '' : outputBrief(t);
          return (
            <div key={t.id} className="result-card">
              <div className="stage-h">
                <h3 style={{ fontSize: 13 }}>{t.title}</h3>
                <span className="hint mono" style={{ color: bad ? 'var(--red-ink)' : undefined }}>
                  {STATUS_TEXT[t.status] ?? t.status} · {dur(t)} · ¥{t.costYuan.toFixed(2)} ·{' '}
                  {t.createdAt.slice(5, 16).replace('T', ' ')}
                </span>
              </div>
              {bad && (
                <div className="hint" style={{ color: 'var(--red-ink)', fontSize: 12 }}>
                  {t.error ?? t.errorCode ?? '失败原因未记录'}
                </div>
              )}
              {brief && (
                <div className="hint mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {brief}
                </div>
              )}
              <div className="stage-foot">
                {t.resultImageId && (
                  <span className="thumb" style={{ cursor: 'default' }}>
                    <span className="ph">
                      <img src={`/api/images/${t.resultImageId}`} alt="" loading="lazy" />
                    </span>
                  </span>
                )}
                {t.documentId && (
                  <button className="btn ghost" onClick={() => void nav(`/editor/${t.documentId}`)}>
                    <Icon name="i-layers" className="ic sm" />
                    打开项目
                  </button>
                )}
                {t.resultImageId && (
                  <a className="btn ghost" href={`/api/images/${t.resultImageId}`} download={`${t.title}-${t.id.slice(3, 11)}`}>
                    <Icon name="i-export" className="ic sm" />
                    下载结果
                  </a>
                )}
                <span className="sp" />
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {t.provider ?? '—'}/{t.model ?? '—'}
                </span>
              </div>
            </div>
          );
        })}

        {loaded && !exhausted && (
          <button className="btn ghost" disabled={loadingMore} onClick={() => void more()}>
            <Icon name="i-retry" className="ic sm" />
            {loadingMore ? '读取中…' : '再读 30 条'}
          </button>
        )}
      </div>
    </div>
  );
}
