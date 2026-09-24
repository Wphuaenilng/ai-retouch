import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTool, toolsByGroup, type DocumentDTO, type ImageDTO, type MeDTO, type TaskDTO, type ToolDef } from '@retouch/shared';
import { api, errorText } from '../../lib/api';
import { prepareUpload } from '../../lib/image';
import { useEvent } from '../../lib/sse';
import { Icon } from '../../ui/Icon';
import { Splitter, useColWidth } from '../../ui/Splitter';
import { ToolForm } from '../tools/ToolForm';

/** 量出容器可用尺寸，图片按它适配 */
function useBox(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

const contain = (nw: number, nh: number, box: { w: number; h: number }): { w: number; h: number } => {
  if (!nw || !nh || !box.w || !box.h) return { w: 0, h: 0 };
  const s = Math.min(box.w / nw, box.h / nh);
  return { w: Math.round(nw * s), h: Math.round(nh * s) };
};

const MIN_S = 0.02;
const MAX_S = 8;

function Compare({ before, after, box }: { before: ImageDTO; after: ImageDTO; box: { w: number; h: number } }): ReactElement {
  const [pos, setPos] = useState(52);
  const ref = useRef<HTMLDivElement>(null);
  const size = contain(after.width, after.height, box);
  const move = (x: number): void => {
    const r = ref.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
  };
  if (!size.w) return <></>;
  return (
    <div
      ref={ref}
      className="cmp"
      style={{ ['--pos' as string]: `${pos}%`, width: size.w, height: size.h }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
    >
      <div className="layer cmp-before">
        <img src={before.url} alt="处理前" />
      </div>
      <div className="layer cmp-after">
        <img src={after.url} alt="处理后" />
      </div>
      <span className="cmp-tag l">处理前</span>
      <span className="cmp-tag r">处理后</span>
      <div className="cmp-handle" />
      <div className="cmp-grip">
        <Icon name="i-compare" className="ic sm" />
      </div>
    </div>
  );
}

/** 工具箱里的图片舞台：滚轮以光标为锚点缩放，按住拖动平移，双击回到适配 */
function ImageStage({ img }: { img: ImageDTO }): ReactElement {
  const [boxRef, box] = useBox();
  const [view, setView] = useState<{ s: number; x: number; y: number } | null>(null);
  const [grab, setGrab] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => setView(null), [img.id]);

  const fit = box.w && box.h ? Math.min(box.w / img.width, box.h / img.height) : 1;
  const s = view?.s ?? fit;
  const ox = view?.x ?? 0;
  const oy = view?.y ?? 0;
  const w = img.width * s;
  const h = img.height * s;
  const zoomTo = (next: number): void => setView({ s: Math.max(MIN_S, Math.min(MAX_S, next)), x: ox, y: oy });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const next = Math.max(MIN_S, Math.min(MAX_S, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const cx = (px - (r.width / 2 + ox)) / s;
      const cy = (py - (r.height / 2 + oy)) / s;
      setView({ s: next, x: px - r.width / 2 - cx * next, y: py - r.height / 2 - cy * next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [boxRef, s, ox, oy]);

  return (
    <div className="viewer">
      <div
        ref={boxRef}
        className={`viewer-box ${img.mime === 'image/png' ? 'alpha' : ''} ${grab ? 'grabbing' : ''}`}
        onPointerDown={(e) => {
          if (e.button > 1) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: ox, y: oy };
          setGrab(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setView({ s, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) });
        }}
        onPointerUp={() => {
          drag.current = null;
          setGrab(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setGrab(false);
        }}
        onDoubleClick={() => setView(null)}
      >
        <img src={img.url} alt="当前图片" style={{ left: (box.w - w) / 2 + ox, top: (box.h - h) / 2 + oy, width: w, height: h }} draggable={false} />
        <span className="cv-hint">滚轮缩放 · 拖动平移 · 双击复位</span>
        <div className="cv-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icbtn" title="缩小" onClick={() => zoomTo(s / 1.2)}>
            <Icon name="i-upscale" className="ic sm" />
          </button>
          <span className="sz mono">{Math.round(s * 100)}%</span>
          <button className="icbtn" title="放大" onClick={() => zoomTo(s * 1.2)}>
            <Icon name="i-plus" className="ic sm" />
          </button>
          <span className="sep" />
          <button className="icbtn" title="适配窗口" onClick={() => setView(null)}>
            <Icon name="i-expand" className="ic sm" />
          </button>
        </div>
      </div>
      <div className="kv mono">
        <span>当前图片</span>
        <span className="v">
          {img.width} × {img.height} · {Math.round(s * 100)}%
        </span>
      </div>
    </div>
  );
}

function CompareStage({ before, after }: { before: ImageDTO; after: ImageDTO }): ReactElement {
  const [ref, box] = useBox();
  return (
    <div className="viewer">
      <div className="viewer-box" ref={ref} style={{ cursor: 'ew-resize' }}>
        <Compare before={before} after={after} box={box} />
      </div>
      <div className="kv mono">
        <span>处理前后</span>
        <span className="v">
          {after.width} × {after.height} · 拖动中线对比
        </span>
      </div>
    </div>
  );
}

export function StudioPage(): ReactElement {
  const nav = useNavigate();
  const [me, setMe] = useState<MeDTO | null>(null);
  const [images, setImages] = useState<ImageDTO[]>([]);
  const [docs, setDocs] = useState<DocumentDTO[]>([]);
  const [tool, setTool] = useState<ToolDef>(() => getTool('cutout')!);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tlW, setTlW, resetTlW] = useColWidth('studio.toolListW', 240, 180, 420);
  const [paW, setPaW, resetPaW] = useColWidth('studio.paramsW', 300, 240, 560);

  const flash = useCallback((text: string, ok = false): void => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const [imgs, ds] = await Promise.all([
      api.get<{ images: ImageDTO[] }>('/api/images?limit=24').catch(() => ({ images: [] as ImageDTO[] })),
      api.get<{ documents: DocumentDTO[] }>('/api/documents').catch(() => ({ documents: [] as DocumentDTO[] })),
    ]);
    setImages(imgs.images);
    setDocs(ds.documents);
    setCurrentId((cur) => cur ?? imgs.images.find((i) => i.kind === 'edit')?.id ?? imgs.images.find((i) => i.kind === 'original')?.id ?? null);
  }, []);

  useEffect(() => {
    void api.get<{ me: MeDTO }>('/api/me').then((r) => setMe(r.me)).catch(() => undefined);
    void refresh();
  }, [refresh]);

  useEvent('task.succeeded', (e) => {
    setTask(e.task);
    void refresh();
    flash(`${e.task.title} 完成`, true);
  });
  useEvent('task.progress', (e) => {
    const t = e.task;
    setTask((cur) => (cur && cur.id === t.id ? t : cur));
  });
  useEvent('task.failed', (e) => {
    setTask(null);
    flash(e.task.error ?? '任务失败');
  });
  useEvent('quota.changed', (e) => setMe((m) => (m ? { ...m, quota: e.quota } : m)));

  const current = useMemo(() => images.find((i) => i.id === currentId) ?? null, [images, currentId]);
  const result = task?.resultImageId ? (images.find((i) => i.id === task.resultImageId) ?? null) : null;

  const onPickFile = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const prepared = await prepareUpload(file);
      const form = new FormData();
      form.append('file', prepared.original, file.name);
      form.append('edit', prepared.edit, `${file.name}.edit.webp`);
      form.append('thumb', prepared.thumb, `${file.name}.thumb.webp`);
      const r = await api.form<{ original: ImageDTO; edit?: ImageDTO; thumb?: ImageDTO }>('/api/uploads', form);
      await refresh();
      setCurrentId(r.edit?.id ?? r.original.id);
      setTask(null);
      flash(`已上传 ${r.original.width}×${r.original.height}`, true);
    } catch (e) {
      flash(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const run = async ({ tool: t, params }: { tool: ToolDef; params: Record<string, unknown> }): Promise<void> => {
    if (t.executor === 'client') {
      // 工具箱里点本地工具，直接进编辑台做（那里才有画布）
      if (!current) return flash('先上传一张图');
      return void nav(`/editor/${await openDoc(current.id)}?tool=${t.name}`);
    }
    if (t.needsImage && !params.imageId) params.imageId = current?.id;
    if (t.needsMask) return void nav(`/editor/${await openDoc(current?.id ?? '')}`);
    setTask({ id: '', tool: t.name, title: t.title, status: 'queued', progress: 0, costYuan: 0, createdAt: '' } as TaskDTO);
    try {
      const r = await api.post<{ task: TaskDTO }>('/api/tasks', { tool: t.name, params });
      // 换成服务端真实任务：进度此后只由 task.progress 事件驱动
      setTask(r.task);
    } catch (e) {
      setTask(null);
      flash(errorText(e));
    }
  };

  const openDoc = useCallback(
    async (imageId: string): Promise<string> => {
      const { document } = await api.post<{ document: DocumentDTO }>('/api/documents', { imageId, title: '未命名项目' });
      return document.id;
    },
    [],
  );

  const busy = Boolean(task && !task.resultImageId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="l">
          <span className="mark" />
          <span className="docname">工具箱</span>
          <span className="save mono">{images.length} 张图 · {docs.length} 个项目</span>
        </div>
        <div className="c" />
        <div className="r">
          <span className="chip mono">今日 {me ? `${me.quota.used}/${me.quota.limit}` : '…'}</span>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Icon name="i-import" className="ic sm" />
            {uploading ? '上传中…' : '上传新图'}
          </button>
          {me?.role === 'admin' && (
            <button className="btn ghost" onClick={() => void nav('/admin')}>
              管理
            </button>
          )}
          <button className="btn ghost" onClick={() => void api.post('/api/auth/logout').then(() => nav('/login'))}>
            退出
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickFile(f);
          e.target.value = '';
        }}
      />

      <div className="studio" style={{ ['--tl-w' as string]: `${tlW}px`, ['--pa-w' as string]: `${paW}px` }}>
        <div className="tool-list">
          <div className="tl-group">AI 工具</div>
          {toolsByGroup('ai')
            .filter((t) => t.priority <= 1)
            .map((t) => (
              <button key={t.name} className={`tl-item ${tool.name === t.name ? 'on' : ''}`} onClick={() => setTool(t)}>
                <Icon name={t.icon} />
                {t.title}
                <span className="cost">¥{t.costYuan}</span>
              </button>
            ))}
          <div className="tl-group">本地工具 · 不计费</div>
          {toolsByGroup('local').map((t) => (
            <button key={t.name} className={`tl-item ${tool.name === t.name ? 'on' : ''}`} onClick={() => setTool(t)}>
              <Icon name={t.icon} />
              {t.title}
              <span className="cost">即时</span>
            </button>
          ))}
        </div>
        <Splitter value={tlW} min={180} max={420} invert onChange={setTlW} onReset={resetTlW} />

        <div className="stage">
          <div className="stage-h">
            <h3>{tool.title}</h3>
            <span className="hint">{tool.agentHint.split('。')[0]}。</span>
          </div>

          {!current && tool.name !== 'text2image' ? (
            <div className="drop" onClick={() => fileRef.current?.click()}>
              拖一张图进来，或点击选择
              <br />
              <span className="mono" style={{ fontSize: 12 }}>
                PNG / JPEG / WebP · 最大 {me ? '20' : '20'}MB · 浏览器内压缩后上传
              </span>
            </div>
          ) : result && current ? (
            <>
              <CompareStage before={current} after={result} />
              <div className="stage-foot">
                <button className="btn ghost" onClick={() => setTask(null)}>
                  再看原图
                </button>
                <span className="sp" />
                <button className="btn" onClick={() => void openDoc(result.id).then((id) => nav(`/editor/${id}`))}>
                  存为新项目
                </button>
                <button className="btn primary" onClick={() => void openDoc(result.id).then((id) => nav(`/editor/${id}`))}>
                  <Icon name="i-layers" className="ic sm" />
                  进入编辑台
                </button>
              </div>
            </>
          ) : (
            <>
              {current && <ImageStage img={current} />}
              {busy && (
                <div className="result-card">
                  <div className="stage-h">
                    <h3 style={{ fontSize: 13 }}>显影中</h3>
                    <span className="hint mono">{Math.round((task?.progress ?? 0) * 100)}%</span>
                  </div>
                  <div className="pbar">
                    <i style={{ width: `${Math.round((task?.progress ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}
              {!busy && (
                <div className="stage-foot">
                  <button className="btn ghost" onClick={() => fileRef.current?.click()}>
                    <Icon name="i-import" className="ic sm" />
                    换一张
                  </button>
                  <span className="sp" />
                  {images.slice(0, 6).map((im) => (
                    <button
                      key={im.id}
                      className={`thumb ${im.id === currentId ? 'on' : ''}`}
                      onClick={() => {
                        setCurrentId(im.id);
                        setTask(null);
                      }}
                    >
                      <span className="ph">
                        <img src={im.url} alt="" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {docs.length > 0 && (
            <div style={{ marginTop: 'auto' }}>
              <div className="tl-group" style={{ padding: '18px 0 8px' }}>
                最 近 项 目
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {docs.slice(0, 8).map((d) => (
                  <button key={d.id} className="thumb" onClick={() => void nav(`/editor/${d.id}`)} title={d.title}>
                    <span className="ph">
                      {d.thumbUrl ? <img src={d.thumbUrl} alt="" /> : <span style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 11, color: 'var(--ink-3)' }}>无缩略</span>}
                    </span>
                    <span className="cap">{d.title.slice(0, 8)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <Splitter value={paW} min={240} max={560} onChange={setPaW} onReset={resetPaW} />
        <div className="params">
          <ToolForm key={tool.name} tool={tool} hasImage={Boolean(current) || tool.name === 'text2image'} hasSelection={false} busy={busy} onSubmit={(s) => void run(s)} />
          <div className="kv mono">
            <span>引擎</span>
            <span className="v">{tool.capability ?? '本地'}</span>
          </div>
          <div className="kv mono">
            <span>配额</span>
            <span className="v">{me ? `今日剩余 ${me.quota.remaining} 次` : '…'}</span>
          </div>
          <div className="hint" style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.8 }}>
            图片会传输给云端模型处理；本项目为邀请制，仅自己与受邀者可见。
          </div>
        </div>
      </div>

      {toast && <div className={`toast ${toast.ok ? 'ok' : ''}`}>{toast.text}</div>}
    </div>
  );
}
