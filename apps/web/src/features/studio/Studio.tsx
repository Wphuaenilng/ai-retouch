import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getTool,
  isToolServable,
  toolBlockedText,
  toolsByGroup,
  type DocumentDTO,
  type ImageDTO,
  type MeDTO,
  type TaskDTO,
  type ToolDef,
} from '@retouch/shared';
import { api, errorText } from '../../lib/api';
import { prepareUpload } from '../../lib/image';
import { untilText } from '../../lib/time';
import { PRIVACY_LINES } from '../../lib/privacy';
import { useEvent } from '../../lib/sse-bus';
import { Icon } from '../../ui/Icon';
import { Splitter } from '../../ui/Splitter';
import { useColWidth } from '../../lib/useColWidth';
import { ConsentModal } from '../privacy/ConsentModal';
import { ToolForm } from '../tools/ToolForm';

/** 账号：改密码。改完服务端会吊销所有会话，所以这里必须重新登录。 */
function AccountMenu({ username }: { username: string }): ReactElement {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nxt, setNxt] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [delName, setDelName] = useState('');
  const [delPass, setDelPass] = useState('');
  const [deleting, setDeleting] = useState(false);

  const destroy = async (): Promise<void> => {
    setDeleting(true);
    setMsg('');
    try {
      await api.del<{ deleted: boolean; files: number }>('/api/me', { username: delName, password: delPass });
      setMsg('账号已注销，正在回到登录页…');
      setTimeout(() => void nav('/login'), 900);
    } catch (e) {
      setMsg(errorText(e));
      setDeleting(false);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setMsg('');
    try {
      await api.post('/api/auth/password', { current: cur, next: nxt });
      setCur('');
      setNxt('');
      setMsg('已修改，正在回到登录页…');
      setTimeout(() => void nav('/login'), 900);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        账号
      </button>
      {open && (
        <div className="popover" style={{ right: 0, top: 'calc(100% + 8px)', width: 250, padding: 14 }}>
          <div className="hint mono" style={{ marginBottom: 8 }}>
            {username}
          </div>
          <div className="field">
            <label>当前密码</label>
            <input
              className="input"
              type="password"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <label>新密码（至少 8 位）</label>
            <input
              className="input"
              type="password"
              value={nxt}
              onChange={(e) => setNxt(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button className="btn primary" disabled={busy || !cur || nxt.length < 8} onClick={() => void submit()}>
            {busy ? '提交中…' : '修改密码'}
          </button>
          {msg && (
            <div className="hint" style={{ marginTop: 8 }}>
              {msg}
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            改密后所有设备都要重新登录。
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="hint" style={{ cursor: 'pointer', color: 'var(--red-ink)' }}>
              注销账号（不可撤销）
            </summary>
            <div className="hint" style={{ fontSize: 11.5, lineHeight: 1.8, margin: '8px 0' }}>
              图片、项目、任务与配额记录会从服务器和磁盘一起删掉；别人拿你的邀请码注册的账号不受影响。
            </div>
            <div className="field">
              <label>再输一次用户名</label>
              <input className="input" value={delName} onChange={(e) => setDelName(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label>密码</label>
              <input
                className="input"
                type="password"
                value={delPass}
                onChange={(e) => setDelPass(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button
              className="btn danger"
              disabled={deleting || delName !== username || delPass.length < 8}
              onClick={() => void destroy()}
            >
              {deleting ? '删除中…' : '永久删除这个账号'}
            </button>
          </details>
        </div>
      )}
    </div>
  );
}

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
        <img
          src={img.url}
          alt="当前图片"
          style={{ left: (box.w - w) / 2 + ox, top: (box.h - h) / 2 + oy, width: w, height: h }}
          draggable={false}
        />
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
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  /** 当前配置真做得到的能力；null = /api/config 还没回来（或老版本没这个字段），此时一律放行 */
  const [caps, setCaps] = useState<string[] | null>(null);
  const [maxMb, setMaxMb] = useState(20);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tlW, setTlW, resetTlW] = useColWidth('studio.toolListW', 240, 180, 420);
  const [paW, setPaW, resetPaW] = useColWidth('studio.paramsW', 300, 240, 560);

  const flash = useCallback((text: string, ok = false): void => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // 失败和"库里真的没有图"要分得开：以前一律 catch 成空数组，
    // 后端挂了用户看到的是"你还没有图片"
    try {
      const [imgs, ds] = await Promise.all([
        api.get<{ images: ImageDTO[] }>('/api/images?limit=24'),
        api.get<{ documents: DocumentDTO[] }>('/api/documents'),
      ]);
      setImages(imgs.images);
      setDocs(ds.documents);
      setLoadError('');
      setCurrentId(
        (cur) =>
          cur ??
          // result 也要能当当前图：文生图没有输入图，只挑 edit/original 的话跑完舞台是空的
          imgs.images.find((i) => i.kind === 'edit')?.id ??
          imgs.images.find((i) => i.kind === 'original')?.id ??
          imgs.images.find((i) => i.kind === 'result')?.id ??
          null,
      );
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void api
      .get<{ me: MeDTO }>('/api/me')
      .then((r) => setMe(r.me))
      .catch(() => undefined);
    // 这是 /api/config 的第一个调用方：工具箱得知道上游当前做得到哪几件事，
    // 以及上传上限是多少（以前这句文案把 20MB 写死在前端，改配置界面还在说 20）
    void api
      .get<{ capabilities?: string[]; maxUploadMb?: number }>('/api/config')
      .then((r) => {
        setCaps(Array.isArray(r.capabilities) ? r.capabilities : null);
        if (typeof r.maxUploadMb === 'number') setMaxMb(r.maxUploadMb);
      })
      .catch(() => undefined);
    void refresh();
  }, [refresh]);

  // 默认选中的是抠图（需要 segment 能力），只配百炼时它是做不到的那一个 ——
  // 能力回来后发现手里这个被置灰了，就换一个做得到的，别让舞台停在一个不能用的工具上
  useEffect(() => {
    if (caps === null || isToolServable(tool, caps)) return;
    const next = toolsByGroup('ai')
      .filter((t) => t.priority <= 1)
      .find((t) => isToolServable(t, caps));
    if (next) setTool(next);
  }, [caps, tool]);

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
  /** 文生图一次可要 2/4 张：服务端全都存了并放进 output.imageIds，这里只是让人挑 */
  const candidates = useMemo(() => {
    const ids = (task?.output as { imageIds?: unknown } | undefined)?.imageIds;
    if (!Array.isArray(ids) || ids.length < 2) return [];
    return ids
      .filter((x): x is string => typeof x === 'string')
      .map((id) => images.find((i) => i.id === id))
      .filter((x): x is ImageDTO => Boolean(x));
  }, [task, images]);

  // 图片第一次离开浏览器之前先问一句（01 §7.1 的产品底线）。确认记在账号上，
  // 所以换浏览器会再问一次 —— 这是故意的，localStorage 里的"同意"跟着设备走，不算数
  const [pending, setPending] = useState<File | null>(null);

  const doUpload = async (file: File): Promise<void> => {
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

  const onPickFile = async (file: File): Promise<void> => {
    if (!me?.consentAt) {
      setPending(file);
      return;
    }
    await doUpload(file);
  };

  // 删掉 = 文件也从盘上走。确认一句，因为这是不可撤销的
  const removeImage = async (id: string): Promise<void> => {
    if (!window.confirm('删除这张图？服务器上的文件会一起删掉，画布用到它的图层会被剥掉。')) return;
    setDeleting(true);
    try {
      const r = await api.del<{ deleted: number; files: number }>(`/api/images/${id}`);
      flash(`已删除 ${r.deleted} 个文件`, true);
      if (currentId === id) setCurrentId(null);
      await refresh();
    } catch (e) {
      flash(errorText(e));
    } finally {
      setDeleting(false);
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
    setTask({ id: '', tool: t.name, title: t.title, status: 'queued', progress: 0, costYuan: 0, createdAt: '' });
    try {
      const r = await api.post<{ task: TaskDTO }>('/api/tasks', { tool: t.name, params });
      // 换成服务端真实任务：进度此后只由 task.progress 事件驱动
      setTask(r.task);
    } catch (e) {
      setTask(null);
      flash(errorText(e));
    }
  };

  const openDoc = useCallback(async (imageId: string): Promise<string> => {
    const { document } = await api.post<{ document: DocumentDTO }>('/api/documents', { imageId, title: '未命名项目' });
    return document.id;
  }, []);

  const busy = Boolean(task && !task.resultImageId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="l">
          <span className="mark" />
          <span className="docname">工具箱</span>
          <span className="save mono">
            {images.length} 张图 · {docs.length} 个项目
          </span>
        </div>
        <div className="c" />
        <div className="r">
          <span className="chip mono">今日 {me ? `${me.quota.used}/${me.quota.limit}` : '…'}</span>
          {/* 只放图标：顶栏在 360 档已经很挤，"记录"两个字省得掉 */}
          <button className="btn ghost" title="历史记录" aria-label="历史记录" onClick={() => void nav('/history')}>
            <Icon name="i-clock" className="ic sm" />
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Icon name="i-import" className="ic sm" />
            {/* 窄屏只留图标：文案在舞台的空态与「换一张」里都有 */}
            <span className="lbl">{uploading ? '上传中…' : '上传新图'}</span>
          </button>
          {me?.role === 'admin' && (
            <button className="btn ghost" onClick={() => void nav('/admin')}>
              管理
            </button>
          )}
          {me && <AccountMenu username={me.username} />}
          <button
            className="btn ghost"
            onClick={() =>
              void api
                .post('/api/auth/logout')
                .then(() => nav('/login'))
                .catch(() => nav('/login'))
            }
          >
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
            .map((t) => {
              const ok = isToolServable(t, caps);
              return (
                <button
                  key={t.name}
                  className={`tl-item ${tool.name === t.name ? 'on' : ''}`}
                  disabled={!ok}
                  title={ok ? undefined : `${toolBlockedText(t)}：换个能做的事，或让管理员配上做得到它的上游`}
                  onClick={() => setTool(t)}
                >
                  <Icon name={t.icon} />
                  {t.title}
                  {/* 置灰而不是消失：藏起来人会以为功能没了，灰着并写明原因才知道是配置问题 */}
                  <span className="cost">{ok ? `¥${t.costYuan}` : '做不到'}</span>
                </button>
              );
            })}
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
            <span className="hint">
              {isToolServable(tool, caps) ? `${tool.agentHint.split('。')[0]}。` : toolBlockedText(tool)}
            </span>
          </div>

          {loadError && (
            <div className="banner warn">
              <span>读不出图片与项目：{loadError}</span>
              <span className="sp" />
              <button
                className="btn ghost"
                onClick={() => {
                  setLoaded(false);
                  void refresh();
                }}
              >
                <Icon name="i-retry" className="ic sm" />
                重试
              </button>
            </div>
          )}

          {!loaded ? (
            <div className="stage-empty">正在读取图片与项目…</div>
          ) : !current && tool.name !== 'text2image' ? (
            <div className="drop" onClick={() => fileRef.current?.click()}>
              拖一张图进来，或点击选择
              <br />
              <span className="mono" style={{ fontSize: 12 }}>
                PNG / JPEG / WebP · 最大 {maxMb}MB · 浏览器内压缩后上传
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
                  {current && (
                    <button className="btn ghost" disabled={deleting} onClick={() => void removeImage(current.id)}>
                      <Icon name="i-trash" className="ic sm" />
                      {deleting ? '删除中…' : '删掉这张'}
                    </button>
                  )}
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

          {/* 文生图的多张候选：刚跑完那一批才给选择，回看时印样条里就有 */}
          {candidates.length > 1 && (
            <>
              <div className="stage-h" style={{ marginTop: 4 }}>
                <h3 style={{ fontSize: 13 }}>候选 {candidates.length} 张</h3>
                <span className="hint">点一张当当前图，四张都已经在库里</span>
              </div>
              <div className="cand-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                {candidates.map((c) => (
                  <button key={c.id} className={`thumb ${currentId === c.id ? 'on' : ''}`} onClick={() => setCurrentId(c.id)}>
                    <span className="ph">
                      <img src={c.url} alt="" />
                    </span>
                  </button>
                ))}
              </div>
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
                      {d.thumbUrl ? (
                        <img src={d.thumbUrl} alt="" />
                      ) : (
                        <span
                          style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 11, color: 'var(--ink-3)' }}
                        >
                          无缩略
                        </span>
                      )}
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
          <ToolForm
            key={tool.name}
            tool={tool}
            hasImage={Boolean(current) || tool.name === 'text2image'}
            hasSelection={false}
            busy={busy}
            onSubmit={(s) => void run(s)}
          />
          <div className="kv mono">
            <span>配额</span>
            <span className="v">{me ? `今日剩余 ${me.quota.remaining} 次 · ${untilText(me.quota.resetsAt)}重置` : '…'}</span>
          </div>
          <details className="notice">
            <summary>上传前须知：图片会交给云端模型处理</summary>
            <ol>
              {PRIVACY_LINES.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
            <div>{me?.consentAt ? `已于 ${me.consentAt.slice(0, 10)} 确认` : '还没确认过 —— 首次上传时会问你一次'}</div>
          </details>
        </div>
      </div>

      {pending && (
        <ConsentModal
          onCancel={() => setPending(null)}
          onDone={() => {
            const f = pending;
            setPending(null);
            // 本地也记一下，免得同一页里传第二张又问一遍
            setMe((m) => (m ? { ...m, consentAt: new Date().toISOString() } : m));
            void doUpload(f);
          }}
        />
      )}

      {toast && <div className={`toast ${toast.ok ? 'ok' : ''}`}>{toast.text}</div>}
    </div>
  );
}
