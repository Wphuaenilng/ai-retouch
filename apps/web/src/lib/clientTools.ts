import Konva from 'konva';
import { getArtHandle, useEditor } from '../state/editor';
import { downloadBlobUrl } from './image';

type FilterProps = { filters: unknown[]; props: Record<string, number> };

/**
 * 调色参数（-1~1）→ Konva 内置滤镜。
 * Konva 核心只有 Brighten / Contrast / HSV / Grayscale 等，没有真锐化：
 * 色温色调用 HSV 的 hue 近似，sharpness 暂不落地（升级路径是 WebGL 滤镜管线）。
 */
export function filterPropsFor(adjust?: Record<string, number>): FilterProps {
  const a = adjust ?? {};
  const filters: unknown[] = [];
  const props: Record<string, number> = {};

  const bright = (a.brightness ?? 0) * 80 + (a.exposure ?? 0) * 60 + (a.highlights ?? 0) * 12 + (a.shadows ?? 0) * 18;
  if (Math.abs(bright) > 0.5) {
    filters.push(Konva.Filters.Brighten);
    // Konva 的 Brighten 内部会再乘 255，这里要交 -1~1；除以 255 让像素增量等于 bright
    props.brightness = bright / 255;
  }
  if (Math.abs(a.contrast ?? 0) > 0.01) {
    filters.push(Konva.Filters.Contrast);
    props.contrast = a.contrast * 100;
  }
  const sat = a.saturation ?? 0;
  const hue = (a.temperature ?? 0) * 25 + (a.tint ?? 0) * 25;
  if (sat <= -0.98) {
    filters.push(Konva.Filters.Grayscale);
  } else if (Math.abs(sat) > 0.01 || Math.abs(hue) > 0.5) {
    filters.push(Konva.Filters.HSV);
    props.saturation = sat;
    props.hue = hue;
  }
  return { filters, props };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const RATIO: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 };

/** 客户端工具的统一入口：手动点按与 Agent 下发走同一条路 */
export async function runClientTool(tool: string, params: Record<string, unknown>): Promise<void> {
  const ed = useEditor.getState();
  if (!ed.doc) throw new Error('当前没有打开的文档');

  if (tool === 'adjust') {
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) if (typeof v === 'number') values[k] = v;
    if (!Object.keys(values).length) throw new Error('没有要调整的参数');
    const targetId = str(params.layerId) ?? ed.doc.canvas.activeLayerId ?? ed.doc.canvas.layers.at(-1)?.id;
    ed.commit((c) => ({
      ...c,
      layers: c.layers.map((l) =>
        l.id === targetId ? { ...l, adjust: { ...(l.adjust ?? {}), ...values } } : l,
      ),
      activeLayerId: targetId ?? c.activeLayerId,
    }));
    return;
  }

  if (tool === 'transform') {
    const ratio = str(params.cropRatio);
    const rotate = num(params.rotate, 0);
    ed.commit((c) => {
      let { width, height } = c;
      let layers = c.layers;

      if (rotate) {
        const rad = (rotate * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const nw = Math.round(width * cos + height * sin);
        const nh = Math.round(width * sin + height * cos);
        layers = layers.map((l) => ({
          ...l,
          transform: {
            ...l.transform,
            rotation: l.transform.rotation + rotate,
            x: l.transform.x + (nw / 2 - width / 2),
            y: l.transform.y + (nh / 2 - height / 2),
          },
        }));
        width = nw;
        height = nh;
      }

      if (ratio && RATIO[ratio]) {
        const target = RATIO[ratio];
        const cur = width / height;
        // 居中裁剪到目标比例
        let cw = width;
        let ch = height;
        if (cur > target) ch = Math.round(width / target);
        else cw = Math.round(height * target);
        const dx = Math.round((cw - width) / 2);
        const dy = Math.round((ch - height) / 2);
        layers = layers.map((l) => ({ ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } }));
        width = cw;
        height = ch;
      }

      if (params.flipH) layers = layers.map((l) => ({ ...l, transform: { ...l.transform, scaleX: -l.transform.scaleX } }));
      if (params.flipV) layers = layers.map((l) => ({ ...l, transform: { ...l.transform, scaleY: -l.transform.scaleY } }));

      return { ...c, width, height, layers };
    });
    return;
  }

  if (tool === 'export') {
    const art = getArtHandle();
    if (!art) throw new Error('画布还没准备好');
    const doc = useEditor.getState().doc;
    if (!doc) throw new Error('没有可导出的文档');
    const format = str(params.format) ?? 'png';
    const scale = num(params.scale, 1) || 1;
    const mimeType = `image/${format === 'jpeg' ? 'jpeg' : format}`;
    const { width, height } = doc.canvas;
    // 视口缩放与平移挂在这个 Group 上：导出要的是作品本身，所以临时回到 1:1 与原点对齐
    const prev = { x: art.x(), y: art.y(), sx: art.scaleX(), sy: art.scaleY() };
    art.position({ x: 0, y: 0 });
    art.scale({ x: 1, y: 1 });
    art.getLayer()?.batchDraw();
    let url = '';
    try {
      url = art.toDataURL({
        x: 0,
        y: 0,
        width,
        height,
        pixelRatio: scale,
        mimeType,
        quality: num(params.quality, 0.92),
      });
    } finally {
      art.position({ x: prev.x, y: prev.y });
      art.scale({ x: prev.sx, y: prev.sy });
      art.getLayer()?.batchDraw();
    }
    downloadBlobUrl(url, `retouch-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`);
    return;
  }

  throw new Error(`浏览器端不认识工具 ${tool}`);
}
