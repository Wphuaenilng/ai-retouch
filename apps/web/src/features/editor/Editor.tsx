import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getTool,
  visibleTools,
  type DocCanvas,
  type DocumentDTO,
  type ImageDTO,
  type MeDTO,
  type TaskDTO,
  type ToolDef,
} from '@retouch/shared';
import { api, errorText } from '../../lib/api';
import { runClientTool } from '../../lib/clientTools';
import { canvasToBlob } from '../../lib/image';
import { useEvent, onSseOpen } from '../../lib/sse-bus';
import { useEditor } from '../../state/editor';
import { Icon } from '../../ui/Icon';
import { Splitter, useColWidth } from '../../ui/Splitter';
import { AgentPanel } from './AgentPanel';
import { CanvasView } from './CanvasView';
import { ToolForm } from '../tools/ToolForm';

function shortLabel(t: ToolDef): string {
  return t.title
    .split(' / ')[0]
    .replace(/（.*?）/g, '')
    .slice(0, 4);
}

/** split_layers 的 output.layers → applyLayers 的入参；不足两层就当没这回事 */
function splitLayerOutput(output: Record<string, unknown> | null | undefined): { name: string; imageId: string | null }[] | null {
  const v = output?.layers;
  if (!Array.isArray(v)) return null;
  const list = v
    .filter((x): x is { name?: unknown; imageId?: unknown } => typeof x === 'object' && x !== null)
    .map((x) => ({
      name: typeof x.name === 'string' ? x.name : '图层',
      imageId: typeof x.imageId === 'string' ? x.imageId : null,
    }))
    .filter((x) => x.imageId !== null);
  return list.length >= 2 ? list : null;
}

function LayersPanel(): ReactElement {
  const doc = useEditor((s) => s.doc);
  const toggleLayer = useEditor((s) => s.toggleLayer);
  const setActive = useEditor((s) => s.setActive);
  const removeLayer = useEditor((s) => s.removeLayer);
  const moveLayer = useEditor((s) => s.moveLayer);
  const setLayerOpacity = useEditor((s) => s.setLayerOpacity);
  if (!doc) return <></>;
  const layers = [...doc.canvas.layers].reverse();
  return (
    <div className="layers">
      <div className="panel-h">
        图 层<span className="tag">{doc.canvas.layers.length} 个</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {layers.map((l, vi) => (
          <div key={l.id}>
            <div
              className={`lrow ${doc.canvas.activeLayerId === l.id ? 'on' : ''} ${l.visible ? '' : 'off'}`}
              role="button"
              tabIndex={0}
              onClick={() => setActive(l.id)}
              onKeyDown={(e) => e.key === 'Enter' && setActive(l.id)}
            >
              <span className="thumb">
                {l.imageId ? (
                  <img src={`/api/images/${l.imageId}`} alt="" />
                ) : (
                  <Icon name={l.kind === 'adjust' ? 'i-adjust' : 'i-layers'} className="ic sm" />
                )}
              </span>
              <span className="nm">{l.name}</span>
              <span className="val">{Math.round(l.opacity * 100)}%</span>
              <button
                className="icbtn"
                style={{ width: 24, height: 24 }}
                aria-label={l.visible ? '隐藏图层' : '显示图层'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayer(l.id);
                }}
              >
                <Icon name={l.visible ? 'i-eye' : 'i-eyeoff'} className="ic sm" />
              </button>
              {doc.canvas.layers.length > 1 && (
                <button
                  className="icbtn"
                  style={{ width: 24, height: 24 }}
                  aria-label="删除图层"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayer(l.id);
                  }}
                >
                  <Icon name="i-x" className="ic sm" />
                </button>
              )}
            </div>
            {/* 只对选中的那一层展开控制，避免每行都挂一套控件把面板挤爆 */}
            {doc.canvas.activeLayerId === l.id && (
              <div className="lctl">
                <button
                  className="icbtn mono"
                  style={{ width: 26, height: 26 }}
                  aria-label="上移一层"
                  disabled={vi === 0}
                  onClick={() => moveLayer(l.id, 1)}
                >
                  ↑
                </button>
                <button
                  className="icbtn mono"
                  style={{ width: 26, height: 26 }}
                  aria-label="下移一层"
                  disabled={vi === layers.length - 1}
                  onClick={() => moveLayer(l.id, -1)}
                >
                  ↓
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={l.opacity}
                  aria-label="图层不透明度"
                  style={{ flex: 1, minWidth: 60 }}
                  onChange={(e) => setLayerOpacity(l.id, Number(e.target.value))}
                />
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', width: 38, textAlign: 'right' }}>
                  {Math.round(l.opacity * 100)}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="layers-foot mono">
        <span>混合 正常</span>
        <span>点击选中 · 可撤销</span>
      </div>
    </div>
  );
}

function FilmStrip({ images, onPick }: { images: ImageDTO[]; onPick: (id: string) => void }): ReactElement {
  const doc = useEditor((s) => s.doc);
  const active = doc?.canvas.layers.find((l) => l.id === doc.canvas.activeLayerId)?.imageId;
  return (
    <div className="strip">
      <i className="sprockets t" />
      <i className="sprockets b" />
      <div className="strip-label">
        接 触 印 样
        <br />
        CONTACTS · {images.length}
      </div>
      <div className="thumbs">
        {images.map((im, i) => (
          <button
            key={im.id}
            className={`thumb ${active === im.id ? 'on' : ''}`}
            onClick={() => onPick(im.id)}
            title={`${im.width}×${im.height}`}
          >
            <span className="ph">
              <img src={im.url} alt="" loading="lazy" />
            </span>
            <span className="cap">
              {String(i + 1).padStart(2, '0')} {im.kind === 'original' ? '原图' : '结果'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorPage(): ReactElement {
  const { id } = useParams();
  const nav = useNavigate();
  const doc = useEditor((s) => s.doc);
  const setDoc = useEditor((s) => s.setDoc);
  const dirty = useEditor((s) => s.dirty);
  const markSaved = useEditor((s) => s.markSaved);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const compare = useEditor((s) => s.compare);
  const setCompare = useEditor((s) => s.setCompare);
  const applyResult = useEditor((s) => s.applyResult);
  const applyLayers = useEditor((s) => s.applyLayers);
  const setMask = useEditor((s) => s.setMask);
  const commit = useEditor((s) => s.commit);

  const [me, setMe] = useState<MeDTO | null>(null);
  const [images, setImages] = useState<ImageDTO[]>([]);
  const [running, setRunning] = useState<TaskDTO | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [dock, setDock] = useState<ToolDef | null>(null);
  /** 小屏下侧栏是浮层，默认收起，否则 340px 会把画布永久盖住 */
  const [sideOpen, setSideOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia('(max-width: 860px)').matches,
  );
  const maskImageId = useRef<string | null>(null);
  const maskUrl = useRef<string | null>(null);
  /** 每笔画一个序号：只有最后一次涂画的回执才允许写回选区，避免慢响应倒序覆盖 */
  const maskSeq = useRef(0);
  const [hasSelection, setHasSelection] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sideW, setSideW, resetSideW] = useColWidth('editor.sideW', 340, 260, 560);

  const flash = useCallback((text: string, ok = false): void => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshImages = useCallback(async (): Promise<void> => {
    const r = await api
      .get<{ images: ImageDTO[] }>(`/api/images?kinds=result,original&limit=12&documentId=${id ?? ''}`)
      .catch(() => null);
    if (r) setImages(r.images.slice(0, 12));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const { document } = await api.get<{ document: DocumentDTO }>(`/api/documents/${id}`);
        setDoc(document);
      } catch (e) {
        flash(errorText(e));
        nav('/studio', { replace: true });
      }
    })();
    void api
      .get<{ me: MeDTO }>('/api/me')
      .then((r) => setMe(r.me))
      .catch(() => undefined);
    void refreshImages();
  }, [id, setDoc, nav, flash, refreshImages]);

  // SSE 每次建立或重连都主动拉一次进行中任务：断线期间错过的终态事件靠这里兜住
  useEffect(
    () =>
      onSseOpen(() => {
        void api
          .get<{ tasks: TaskDTO[] }>('/api/tasks/active')
          .then((r) => {
            const mine = r.tasks.find((x) => x.documentId === id);
            if (mine) setRunning((cur) => cur ?? mine);
          })
          .catch(() => undefined);
      }),
    [id],
  );

  // 自动保存（防抖 900ms）：记下发出时的 version，回包只清那一版的脏标记
  const unsaved = useRef<{ id: string; canvas: DocCanvas } | null>(null);
  useEffect(() => {
    if (!doc) return;
    unsaved.current = dirty ? { id: doc.id, canvas: doc.canvas } : null;
  }, [doc, dirty]);

  useEffect(() => {
    if (!doc || !dirty) return undefined;
    const v = useEditor.getState().version;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api
        .patch<{ document: DocumentDTO }>(`/api/documents/${doc.id}`, { canvas: doc.canvas })
        .then((r) => markSaved(r.document.updatedAt, v))
        .catch((e) => flash(errorText(e)));
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [doc, dirty, markSaved, flash]);

  // 切文档/关页面时把最后一版尽力发出去，别让"未保存…"直接蒸发
  useEffect(
    () => () => {
      const pending = unsaved.current;
      if (!pending) return;
      void fetch(`/api/documents/${pending.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvas: pending.canvas }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [],
  );

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void (async () => {
          if (!doc) return;
          const v = useEditor.getState().version;
          try {
            const r = await api.patch<{ document: DocumentDTO }>(`/api/documents/${doc.id}`, { canvas: doc.canvas });
            markSaved(r.document.updatedAt, v);
            flash('已保存', true);
          } catch (e) {
            flash(errorText(e));
          }
        })();
      } else if (e.key === '[') setBrushSize(-2);
      else if (e.key === ']') setBrushSize(2);
      else if (e.key === '\\') setCompare(!useEditor.getState().compare);
    };
    const setBrushSize = (d: number): void => {
      const s = useEditor.getState();
      s.setBrushSize(s.brushSize + d * 4);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, doc, markSaved, flash, setCompare]);

  const appliedTasks = useRef(new Set<string>());

  useEvent('task.succeeded', (e) => {
    const t = e.task;
    setRunning(null);
    if (!t.resultImageId) return;
    // 断线重放与重复推送都可能到达：只认属于当前文档、且本页还没应用过的任务
    if (t.documentId && t.documentId !== doc?.id) return;
    if (appliedTasks.current.has(t.id)) return;
    appliedTasks.current.add(t.id);
    const layers = splitLayerOutput(t.output);
    if (layers) {
      applyLayers(layers, true);
      flash(`已拆成 ${layers.length} 层，可分别选中调整`, true);
    } else {
      applyResult(t.resultImageId, getTool(t.tool)?.title ?? t.tool);
      flash(`${getTool(t.tool)?.title ?? t.tool} 完成`, true);
    }
    void refreshImages();
    if (t.costYuan)
      void api
        .get<{ me: MeDTO }>('/api/me')
        .then((r) => setMe(r.me))
        .catch(() => undefined);
  });

  useEvent('task.progress', (e) => {
    const t = e.task;
    setRunning((cur) => (cur && cur.id === t.id ? t : cur));
  });

  useEvent('task.failed', (e) => {
    setRunning(null);
    flash(e.task.error ?? '任务失败');
  });

  useEvent('quota.changed', (e) => setMe((m) => (m ? { ...m, quota: e.quota } : m)));

  const onMaskChange = useCallback(
    (canvas: HTMLCanvasElement | null, kind: 'brush' | 'rect' = 'brush'): void => {
      const seq = (maskSeq.current += 1);
      if (!canvas) {
        maskImageId.current = null;
        setHasSelection(false);
        if (maskUrl.current) URL.revokeObjectURL(maskUrl.current);
        maskUrl.current = null;
        setMask(null);
        return;
      }
      void (async () => {
        const blob = await canvasToBlob(canvas, 'image/png');
        if (seq !== maskSeq.current) return;
        if (maskUrl.current) URL.revokeObjectURL(maskUrl.current);
        maskUrl.current = blob ? URL.createObjectURL(blob) : null;
        setMask(maskUrl.current);
        if (!blob) return;
        const form = new FormData();
        form.append('mask', blob, 'mask.png');
        try {
          const r = await api.form<{ mask: ImageDTO }>('/api/uploads', form);
          if (seq !== maskSeq.current) return;
          maskImageId.current = r.mask.id;
          setHasSelection(true);
          commit((c) => ({ ...c, selection: { kind, maskImageId: r.mask.id } }));
          flash('选区已就绪，可以执行消除或局部替换', true);
        } catch (e) {
          if (seq === maskSeq.current) flash(errorText(e));
        }
      })();
    },
    [setMask, commit, flash],
  );

  useEffect(
    () => () => {
      if (maskUrl.current) URL.revokeObjectURL(maskUrl.current);
    },
    [],
  );

  const runTool = useCallback(
    async (t: ToolDef, params: Record<string, unknown>): Promise<void> => {
      if (t.executor === 'client') {
        try {
          await runClientTool(t.name, params);
          flash(`${t.title} 已应用（可撤销）`, true);
        } catch (e) {
          flash(errorText(e));
        }
        return;
      }
      const full = { ...params };
      if (t.needsImage && !full.imageId) {
        const active = doc?.canvas.layers.find((l) => l.id === doc.canvas.activeLayerId) ?? doc?.canvas.layers.at(-1);
        full.imageId = active?.imageId ?? doc?.canvas.sourceImageId;
      }
      if (t.needsMask && !full.maskImageId) full.maskImageId = maskImageId.current;
      setRunning({ id: '', tool: t.name, title: t.title, status: 'queued', progress: 0, costYuan: 0, createdAt: '' } as TaskDTO);
      try {
        const r = await api.post<{ task: TaskDTO }>('/api/tasks', { tool: t.name, params: full, documentId: doc?.id });
        // 换成服务端真实任务：进度此后只由 task.progress 事件驱动
        setRunning(r.task);
      } catch (e) {
        setRunning(null);
        flash(errorText(e));
      }
    },
    [doc, flash],
  );

  const pickImage = useCallback(
    (imageId: string) => {
      applyResult(imageId, '印样选帧');
    },
    [applyResult],
  );

  const dockTool = dock;
  const hasImage = useMemo(() => Boolean(doc?.canvas.layers.some((l) => l.imageId)), [doc]);

  if (!doc) {
    return (
      <div className="shell">
        <div className="cv" style={{ flex: 1 }}>
          <div className="empty">正在打开文档…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ ['--side-w' as string]: `${sideW}px` }}>
      <header className="topbar">
        <div className="l">
          <Link to="/studio" className="icbtn" aria-label="返回工具箱">
            <Icon name="i-left" />
          </Link>
          <span className="docname">{doc.title}</span>
          <span className="save mono">
            {dirty
              ? '未保存…'
              : doc
                ? `已保存 ${new Date(doc.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
          </span>
        </div>
        <div className="c">
          <button className="icbtn" onClick={undo} disabled={!past} aria-label="撤销" title="撤销 (⌘Z)">
            <Icon name="i-undo" />
          </button>
          <button className="icbtn" onClick={redo} disabled={!future} aria-label="重做" title="重做 (⇧⌘Z)">
            <Icon name="i-redo" />
          </button>
          <span className="sep" />
          <button
            className={`icbtn ${compare ? 'on' : ''}`}
            onClick={() => setCompare(!compare)}
            aria-label="前后对比"
            title="前后对比 (\)"
          >
            <Icon name="i-compare" />
          </button>
          {running && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, maxWidth: 220 }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>
                {running.title}
              </span>
              <span className="pbar" style={{ width: 90 }}>
                <i style={{ width: `${Math.round(running.progress * 100)}%` }} />
              </span>
            </span>
          )}
        </div>
        <div className="r">
          <button className="btn ghost side-toggle" onClick={() => setSideOpen((v) => !v)} aria-expanded={sideOpen}>
            {sideOpen ? '收起面板' : '面板'}
          </button>
          <span className="chip mono">今日 {me ? `${me.quota.used}/${me.quota.limit}` : '…'}</span>
          <button
            className="btn primary"
            onClick={() =>
              void runClientTool('export', { format: 'png', scale: 1 }).catch((e: unknown) =>
                flash(e instanceof Error ? `导出失败：${e.message}` : '导出失败'),
              )
            }
          >
            <Icon name="i-export" className="ic sm" />
            导出
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          {visibleTools().map((t) => (
            <button
              key={t.name}
              className={tool === t.name ? 'on' : ''}
              title={`${t.title}${t.costYuan ? ` · 约 ¥${t.costYuan}` : ' · 本地'}`}
              onClick={() => {
                setTool(t.name);
                setDock(t);
              }}
            >
              <Icon name={t.icon} className="ic lg" />
              {shortLabel(t)}
            </button>
          ))}
          <span className="spacer" />
          <button
            className={tool === 'hand' ? 'on' : ''}
            title="平移画布 · 也可直接拖动空白处或按住空格"
            onClick={() => setTool('hand')}
          >
            <Icon name="i-hand" className="ic lg" />手
          </button>
        </nav>

        <CanvasView tool={tool} onMaskChange={onMaskChange} />

        <Splitter value={sideW} min={260} max={560} onChange={setSideW} onReset={resetSideW} />
        <aside className={sideOpen ? 'side open' : 'side'}>
          <AgentPanel documentId={doc.id} />
          <LayersPanel />
        </aside>
      </div>

      <FilmStrip images={images} onPick={pickImage} />

      {dockTool && (
        <div
          style={{
            position: 'absolute',
            right: 'calc(var(--side-w) + 24px)',
            bottom: 'calc(var(--strip-h) + 20px)',
            width: 320,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 24px 70px rgba(0,0,0,.55)',
            zIndex: 40,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Icon name={dockTool.icon} className="ic" />
            <b style={{ fontSize: 13 }}>{dockTool.title}</b>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              {dockTool.costYuan > 0 ? `约 ¥${dockTool.costYuan}` : '本地 · 不计费'}
            </span>
            <button className="icbtn" style={{ marginLeft: 'auto' }} aria-label="关闭" onClick={() => setDock(null)}>
              <Icon name="i-x" className="ic sm" />
            </button>
          </div>
          <ToolForm
            key={dockTool.name}
            tool={dockTool}
            compact
            hasImage={hasImage}
            hasSelection={hasSelection}
            busy={Boolean(running)}
            onSubmit={({ tool: t, params }) => void runTool(t, params)}
          />
        </div>
      )}

      {toast && <div className={`toast ${toast.ok ? 'ok' : ''}`}>{toast.text}</div>}
    </div>
  );
}
