import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Image as KImage,
  Group as KGroup,
  Layer as KLayer,
  Rect as KRect,
  Stage,
  Transformer as KTransformer,
} from 'react-konva';
import type Konva from 'konva';
import type { DocLayer } from '@retouch/shared';
import { centerPivot } from '../../lib/artboard';
import { filterPropsFor } from '../../lib/clientTools';
import { setArtHandle, useEditor, type Viewport } from '../../state/editor';
import { Icon } from '../../ui/Icon';

/** 解码后的位图会一直占内存（一张 2048 约 16MB），必须有个上限 */
const cache = new Map<string, HTMLImageElement>();
const CACHE_MAX = 24;

function cacheTouch(url: string, img: HTMLImageElement): void {
  cache.delete(url);
  cache.set(url, img);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === url) break;
    cache.delete(oldest);
  }
}

function useImage(url: string | null): HTMLImageElement | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit) {
      cacheTouch(url, hit);
      force((n) => n + 1);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cache.set(url, img);
      force((n) => n + 1);
    };
    img.onerror = () => force((n) => n + 1);
    img.src = url;
  }, [url]);
  return url ? (cache.get(url) ?? null) : null;
}

/** 文档里存的是人话（normal），Konva 要的是 canvas 合成名（source-over） */
const BLEND: Record<DocLayer['blend'], 'source-over' | 'multiply' | 'screen'> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
};

/** 图层节点登记表：稳定引用，避免每次渲染都新建回调导致滤镜缓存被反复重烘 */
interface NodeRegistry {
  set: (id: string, node: Konva.Image) => void;
  drop: (id: string, node: Konva.Image | null) => void;
  get: (id: string) => Konva.Image | undefined;
}

function LayerNode({ layer, registry }: { layer: DocLayer; registry: NodeRegistry }): ReactElement | null {
  const img = useImage(layer.imageId ? `/api/images/${layer.imageId}` : null);
  const { filters, props } = filterPropsFor(layer.adjust);
  const ref = useRef<Konva.Image>(null);
  const filtered = filters.length > 0;

  // Konva 只在节点被 cache 之后才应用滤镜；重复 cache 会把已上滤镜的结果再烘一遍，所以先清
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.clearCache();
    if (filtered) node.cache();
    node.getLayer()?.batchDraw();
    registry.set(layer.id, node);
    return () => registry.drop(layer.id, node);
  }, [filtered, img, layer.id, registry]);

  if (!img || !layer.visible) return null;
  return (
    <KImage
      ref={ref}
      image={img}
      x={layer.transform.x}
      y={layer.transform.y}
      scaleX={layer.transform.scaleX}
      scaleY={layer.transform.scaleY}
      rotation={layer.transform.rotation}
      opacity={layer.opacity}
      globalCompositeOperation={BLEND[layer.blend]}
      listening={false}
      filters={filters as never}
      {...props}
    />
  );
}

/** 拖出来的矩形（起点/终点无序） */
function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** 遮罩笔刷画布：坐标直接用图片像素空间，导出即上游要的 mask */
function MaskLayer({
  width,
  height,
  box,
  active,
  mode,
  space,
  size,
  clearToken,
  onExport,
}: {
  width: number;
  height: number;
  box: { left: number; top: number; w: number; h: number };
  active: boolean;
  /** pen=涂抹，rect=拖一个矩形框选；两者写进同一张 mask 画布 */
  mode: 'brush' | 'rect';
  space: boolean;
  size: number;
  clearToken: number;
  onExport: (canvas: HTMLCanvasElement | null, kind: 'brush' | 'rect') => void;
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const rectStart = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);

  // × 清空必须真的擦掉像素，否则涂痕还留在画布上、只是不再上传
  useEffect(() => {
    const el = ref.current;
    el?.getContext('2d')?.clearRect(0, 0, el.width, el.height);
  }, [clearToken]);

  // 按住空格或中键时让给画布平移
  const painting = (): boolean => active && !space;

  const toCanvas = (e: React.PointerEvent): { x: number; y: number } => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  const stroke = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (size / box.w) * width;
    if (from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.w,
        height: box.h,
        opacity: 0.45,
        cursor: active ? 'crosshair' : 'default',
        pointerEvents: painting() ? 'auto' : 'none',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (!painting()) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = toCanvas(e);
        if (mode === 'rect') {
          const ctx = ref.current!.getContext('2d');
          snapshot.current = ctx?.getImageData(0, 0, width, height) ?? null;
          rectStart.current = p;
          return;
        }
        drawing.current = null;
        stroke(null, p);
        drawing.current = p;
      }}
      onPointerMove={(e) => {
        if (!painting()) return;
        const p = toCanvas(e);
        if (mode === 'rect') {
          if (!rectStart.current) return;
          const ctx = ref.current!.getContext('2d');
          if (!ctx || !snapshot.current) return;
          // 预览：回到按下时的快照再叠一层半透明白，松手才落成实心 mask
          ctx.putImageData(snapshot.current, 0, 0);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          const r = rectOf(rectStart.current, p);
          ctx.fillRect(r.x, r.y, r.w, r.h);
          return;
        }
        if (!drawing.current) return;
        stroke(drawing.current, p);
        drawing.current = p;
      }}
      onPointerUp={(e) => {
        if (!painting()) return;
        if (mode === 'rect') {
          const start = rectStart.current;
          rectStart.current = null;
          snapshot.current = null;
          if (!start) return;
          const p = toCanvas(e);
          const r = rectOf(start, p);
          if (r.w < 2 || r.h < 2) return; // 当成误点，不清空也不新增
          const ctx = ref.current!.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(r.x, r.y, r.w, r.h);
          onExport(ref.current, 'rect');
          return;
        }
        drawing.current = null;
        onExport(ref.current, 'brush');
      }}
      onPointerCancel={() => {
        drawing.current = null;
        rectStart.current = null;
        snapshot.current = null;
      }}
    />
  );
}

/** 前后对比：左边显示原图，右边是 Konva 合成结果，中线可拖 */
function CompareOverlay({
  box,
  sourceImageId,
  space,
}: {
  box: { left: number; top: number; w: number; h: number };
  sourceImageId: string | null;
  space: boolean;
}): ReactElement | null {
  const compare = useEditor((s) => s.compare);
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  if (!compare || !sourceImageId || box.w === 0) return null;

  const move = (clientX: number): void => {
    const r = ref.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.w,
        height: box.h,
        cursor: 'ew-resize',
        touchAction: 'none',
        pointerEvents: space ? 'none' : 'auto',
        zIndex: 5,
      }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) move(e.clientX);
      }}
    >
      <img
        src={`/api/images/${sourceImageId}`}
        alt="原图"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          clipPath: `inset(0 ${100 - pos}% 0 0)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${pos}%`,
          width: 1,
          background: 'rgba(233,233,229,.85)',
          pointerEvents: 'none',
        }}
      />
      <span className="cmp-tag l" style={{ position: 'absolute', top: 8, left: 8 }}>
        原图
      </span>
      <span className="cmp-tag r" style={{ position: 'absolute', top: 8, right: 8 }}>
        当前
      </span>
    </div>
  );
}

export function CanvasView({
  tool,
  onMaskChange,
}: {
  tool: string;
  onMaskChange: (canvas: HTMLCanvasElement | null, kind?: 'brush' | 'rect') => void;
}): ReactElement {
  const doc = useEditor((s) => s.doc);
  const viewport = useEditor((s) => s.viewport);
  const setViewport = useEditor((s) => s.setViewport);
  const fitViewport = useEditor((s) => s.fitViewport);
  const brushSize = useEditor((s) => s.brushSize);
  const setBrushSize = useEditor((s) => s.setBrushSize);
  const compare = useEditor((s) => s.compare);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const artRef = useRef<Konva.Group>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [space, setSpace] = useState(false);
  const [grab, setGrab] = useState(false);
  const [maskClear, setMaskClear] = useState(0);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  /** 正在拖手柄：把容器上的平移让开 */
  const transforming = useRef(false);
  const setLayerTransform = useEditor((s) => s.setLayerTransform);
  const nodes = useRef(new Map<string, Konva.Image>());
  const registry = useMemo<NodeRegistry>(
    () => ({
      set: (id, node) => {
        nodes.current.set(id, node);
      },
      drop: (id, node) => {
        if (nodes.current.get(id) === node) nodes.current.delete(id);
      },
      get: (id) => nodes.current.get(id),
    }),
    [],
  );
  const [target, setTarget] = useState<Konva.Image | null>(null);

  /** 变换手柄的配色跟着 tokens 走，别在组件里散落硬编码色值 */
  const handleColors = useMemo(() => {
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
    const v = (name: string, fallback: string): string => css?.getPropertyValue(name).trim() || fallback;
    return { border: v('--line', '#5A5F66'), anchor: v('--red', '#B9432A') };
  }, []);

  useEffect(() => {
    const id = doc?.canvas.activeLayerId;
    setTarget(id ? (registry.get(id) ?? null) : null);
  }, [doc?.canvas.activeLayerId, doc?.canvas.layers, registry]);

  /** Konva 绕节点原点做变换；回写前把中心拉回原位，数学部分见 test/artboard.test.ts */
  const onTransformEnd = (): void => {
    const canvas0 = useEditor.getState().doc?.canvas;
    const id = canvas0?.activeLayerId;
    if (!target || !id) return;
    const layer = canvas0?.layers.find((l) => l.id === id);
    if (!layer) return;
    const image = target.image() as HTMLImageElement | undefined;
    const size = { w: image?.naturalWidth ?? 0, h: image?.naturalHeight ?? 0 };
    const naive = { x: target.x(), y: target.y(), scaleX: target.scaleX(), scaleY: target.scaleY(), rotation: target.rotation() };
    const fixed = size.w > 0 && size.h > 0 ? centerPivot(layer.transform, size, naive) : naive;
    setLayerTransform(id, {
      x: fixed.x,
      y: fixed.y,
      scaleX: fixed.scaleX,
      scaleY: fixed.scaleY,
      // 归一化到 (-180,180]：不改变矩阵，只是别让角度一路累加
      rotation: (((fixed.rotation % 360) + 540) % 360) - 180,
    });
  };

  useEffect(() => {
    setArtHandle(artRef.current);
    return () => setArtHandle(null);
  }, []);

  useEffect(() => {
    const editable = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'BUTTON' ||
          el.isContentEditable)
      );
    };
    const dn = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || editable(e.target)) return;
      e.preventDefault();
      setSpace(true);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpace(false);
    };
    const blur = (): void => setSpace(false);
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ⌘/Ctrl+0 适配窗口、⌘/Ctrl+1 回到 100%（部分浏览器会抢走 ⌘1，所以左下角百分比也能点）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === '0') {
        e.preventDefault();
        fitViewport({ w: box.w, h: box.h });
      } else if (e.key === '1') {
        e.preventDefault();
        setViewport({ scale: 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [box.w, box.h, fitViewport, setViewport]);

  // 容器尺寸变化时重新计算适配
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
      fitViewport({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitViewport, doc?.id]);

  const canvas = doc?.canvas;
  const scale = viewport.scale;
  const art = useMemo(() => {
    if (!canvas) return { left: 0, top: 0, w: 0, h: 0 };
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    return { left: (box.w - w) / 2 + viewport.x, top: (box.h - h) / 2 + viewport.y, w, h };
  }, [canvas, scale, box.w, box.h, viewport.x, viewport.y]);

  const vignette = canvas?.layers.find((l) => l.visible && (l.adjust?.vignette ?? 0) > 0)?.adjust?.vignette ?? 0;
  const fade = canvas?.layers.find((l) => l.visible && (l.adjust?.fade ?? 0) > 0)?.adjust?.fade ?? 0;

  /** 中键、空格、手型，或图片以外的空白 —— 都算拖画布；图内左键让给笔刷和对比滑杆 */
  const wantPan = (e: React.PointerEvent): boolean => {
    if (e.button === 1 || space) return true;
    if (e.button > 1 || !canvas) return false;
    if (tool === 'hand') return true;
    const el = wrapRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const inside = x >= art.left && x <= art.left + art.w && y >= art.top && y <= art.top + art.h;
    if (!inside) return true;
    return tool !== 'brush' && tool !== 'rect' && !compare;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage || !canvas) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const next = Math.max(0.05, Math.min(6, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    // 以光标为锚点：先算指针在画布内容空间的坐标，缩放后反推偏移
    const cx = (pointer.x - art.left) / scale;
    const cy = (pointer.y - art.top) / scale;
    const nx = pointer.x - cx * next - (box.w - canvas.width * next) / 2;
    const ny = pointer.y - cy * next - (box.h - canvas.height * next) / 2;
    setViewport({ scale: next, x: nx, y: ny });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!canvas) {
    return (
      <div className="cv" ref={wrapRef}>
        <div className="empty">
          还没有图片
          <br />
          从左侧选一个功能，或先上传一张
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cv ${tool === 'brush' ? '' : 'pan'} ${grab ? 'grabbing' : ''}`}
      ref={wrapRef}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onPointerDown={(e) => {
        if (!wantPan(e)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, x: viewport.x, y: viewport.y };
        setGrab(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || transforming.current) return;
        setViewport({ x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) });
      }}
      onPointerUp={() => {
        drag.current = null;
        transforming.current = false;
        setGrab(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        transforming.current = false;
        setGrab(false);
      }}
      onDoubleClick={() => fitViewport({ w: box.w, h: box.h })}
    >
      <span className="cv-hint">滚轮缩放 · 拖动平移 · 双击适配</span>
      {/* Stage 铺满 .cv，位移和缩放交给 Group：Konva 把 Stage 的 x/y 写成容器 padding，图片会被裁没 */}
      <Stage ref={stageRef} width={Math.max(1, box.w)} height={Math.max(1, box.h)}>
        <KLayer listening={false}>
          <KGroup ref={artRef} x={art.left} y={art.top} scaleX={scale} scaleY={scale}>
            {canvas.layers.map((l) => (
              <LayerNode key={l.id} layer={l} registry={registry} />
            ))}
            {vignette > 0 && (
              <KRect
                width={canvas.width}
                height={canvas.height}
                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                fillLinearGradientEndPoint={{ x: canvas.width, y: canvas.height }}
                fillLinearGradientColorStops={[
                  0,
                  `rgba(0,0,0,${vignette * 0.5})`,
                  0.5,
                  'rgba(0,0,0,0)',
                  1,
                  `rgba(0,0,0,${vignette * 0.5})`,
                ]}
              />
            )}
            {fade > 0 && <KRect width={canvas.width} height={canvas.height} fill={`rgba(233,233,229,${fade * 0.28})`} />}
          </KGroup>
        </KLayer>

        {/* 变换手柄单独一层：那一层是 listening={false}，手柄要能接事件 */}
        <KLayer>
          {target && tool !== 'brush' && !compare && !space && !grab && (
            <KTransformer
              nodes={[target]}
              rotateEnabled
              flipEnabled
              anchorSize={9}
              anchorCornerRadius={2}
              borderStroke={handleColors.border}
              anchorStroke={handleColors.anchor}
              anchorFill="#141416"
              onMouseDown={() => {
                // 手柄按下时取消可能已经启动的平移（DOM pointerdown 比 Konva 的 mousedown 早到）
                transforming.current = true;
                drag.current = null;
              }}
              onTransformEnd={onTransformEnd}
            />
          )}
        </KLayer>
      </Stage>

      <MaskLayer
        width={canvas.width}
        height={canvas.height}
        box={art}
        active={tool === 'brush' || tool === 'rect'}
        mode={tool === 'rect' ? 'rect' : 'brush'}
        space={space}
        size={brushSize}
        clearToken={maskClear}
        onExport={onMaskChange}
      />

      <CompareOverlay box={art} sourceImageId={canvas.sourceImageId} space={space} />

      <div className="cv-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icbtn" title="缩小" onClick={() => setViewport({ scale: Math.max(0.05, scale / 1.2) })}>
          <Icon name="i-upscale" className="ic sm" />
        </button>
        <span className="sz mono">{Math.round(scale * 100)}%</span>
        <button className="icbtn" title="放大" onClick={() => setViewport({ scale: Math.min(6, scale * 1.2) })}>
          <Icon name="i-plus" className="ic sm" />
        </button>
        <span className="sep" />
        <button className="icbtn" title="适配窗口（⌘/Ctrl+0）" onClick={() => fitViewport({ w: box.w, h: box.h })}>
          <Icon name="i-expand" className="ic sm" />
        </button>
        <button className="icbtn" title="回到 100%（⌘/Ctrl+1）" onClick={() => setViewport({ scale: 1 })}>
          <span className="mono" style={{ fontSize: 10 }}>
            1:1
          </span>
        </button>
        <button
          className={`icbtn ${tool === 'brush' ? 'on' : ''}`}
          title="涂抹选区（[ ] 调整笔刷）"
          onClick={() => {
            const next = tool === 'brush' ? 'hand' : 'brush';
            useEditor.getState().setTool(next);
          }}
        >
          <Icon name="i-brush" className="ic sm" />
        </button>
        <button
          className={`icbtn ${tool === 'rect' ? 'on' : ''}`}
          title="框选区域（拖一个矩形，可与涂抹叠加）"
          onClick={() => {
            const next = tool === 'rect' ? 'hand' : 'rect';
            useEditor.getState().setTool(next);
          }}
        >
          <Icon name="i-crop" className="ic sm" />
        </button>
        {tool === 'brush' && (
          <>
            <input
              type="range"
              min={6}
              max={160}
              value={brushSize}
              style={{ width: 90 }}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              aria-label="笔刷大小"
            />
            <button
              className="icbtn"
              title="清空选区"
              onClick={() => {
                setMaskClear((n) => n + 1);
                onMaskChange(null);
              }}
            >
              <Icon name="i-x" className="ic sm" />
            </button>
          </>
        )}
      </div>

      <span className="zoom-chip">
        {canvas.width} × {canvas.height}
      </span>
    </div>
  );
}

export type { Viewport };
