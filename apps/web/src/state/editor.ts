import { create } from 'zustand';
import type Konva from 'konva';
import type { DocCanvas, DocumentDTO } from '@retouch/shared';

const HISTORY_CAP = 50;

export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

interface EditorState {
  doc: DocumentDTO | null;
  past: DocCanvas[];
  future: DocCanvas[];
  viewport: Viewport;
  tool: string;
  brushSize: number;
  maskPng: string | null;
  compare: boolean;
  dirty: boolean;
  savedAt: string | null;

  setDoc: (doc: DocumentDTO | null) => void;
  setViewport: (v: Partial<Viewport>) => void;
  fitViewport: (box: { w: number; h: number }) => void;
  setTool: (t: string) => void;
  setBrushSize: (n: number) => void;
  setMask: (png: string | null) => void;
  setCompare: (on: boolean) => void;
  markSaved: (at: string) => void;

  /** 所有会改变画面的操作都走这里，撤销/重做与自动保存因此自动成立 */
  commit: (mutate: (canvas: DocCanvas) => DocCanvas, label?: string) => void;
  undo: () => void;
  redo: () => void;

  /** AI 结果：替换当前图层图源 */
  applyResult: (imageId: string, label: string) => void;
  /** 图层拆分等一次产出多层的场景 */
  applyLayers: (list: { name: string; imageId: string | null }[], keepBase?: boolean) => void;
  toggleLayer: (id: string) => void;
  setActive: (id: string) => void;
  removeLayer: (id: string) => void;
}

const clone = (c: DocCanvas): DocCanvas => JSON.parse(JSON.stringify(c)) as DocCanvas;
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  past: [],
  future: [],
  viewport: { scale: 1, x: 0, y: 0 },
  tool: 'adjust',
  brushSize: 28,
  maskPng: null,
  compare: false,
  dirty: false,
  savedAt: null,

  setDoc: (doc) => set({ doc, past: [], future: [], dirty: false, maskPng: null }),
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  setTool: (tool) => set({ tool }),
  setBrushSize: (brushSize) => set({ brushSize: Math.max(6, Math.min(200, brushSize)) }),
  setMask: (maskPng) => set({ maskPng }),
  setCompare: (compare) => set({ compare }),
  markSaved: (at) => set({ dirty: false, savedAt: at }),

  fitViewport: ({ w, h }) => {
    const { doc } = get();
    if (!doc || !w || !h) return;
    const pad = 56;
    const scale = Math.min((w - pad) / doc.canvas.width, (h - pad) / doc.canvas.height, 1);
    set({ viewport: { scale, x: 0, y: 0 } });
  },

  commit: (mutate, _label) => {
    const { doc, past } = get();
    if (!doc) return;
    const next = mutate(clone(doc.canvas));
    set({
      doc: { ...doc, canvas: next, updatedAt: new Date().toISOString() },
      past: [...past, clone(doc.canvas)].slice(-HISTORY_CAP),
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { doc, past, future } = get();
    if (!doc || !past.length) return;
    const prev = past[past.length - 1]!;
    set({
      doc: { ...doc, canvas: prev },
      past: past.slice(0, -1),
      future: [clone(doc.canvas), ...future].slice(0, HISTORY_CAP),
      dirty: true,
    });
  },

  redo: () => {
    const { doc, past, future } = get();
    if (!doc || !future.length) return;
    const next = future[0]!;
    set({
      doc: { ...doc, canvas: next },
      past: [...past, clone(doc.canvas)].slice(-HISTORY_CAP),
      future: future.slice(1),
      dirty: true,
    });
  },

  applyResult: (imageId, label) =>
    get().commit((c) => {
      const id = c.activeLayerId ?? c.layers.at(-1)?.id;
      const layers = c.layers.map((l) => (l.id === id ? { ...l, imageId, name: label.slice(0, 24) } : l));
      return { ...c, layers };
    }),

  applyLayers: (list, keepBase = true) =>
    get().commit((c) => {
      const created = list.map((l, i) => ({
        id: newId('L'),
        kind: (i === 0 ? 'subject' : 'background') as 'subject' | 'background',
        name: l.name,
        imageId: l.imageId,
        visible: true,
        opacity: 1,
        blend: 'normal' as const,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      }));
      const base = keepBase
        ? c.layers.map((l) => ({ ...l, visible: false })).slice(0, 1)
        : [];
      return { ...c, layers: [...base, ...created], activeLayerId: created[0]?.id ?? null };
    }),

  toggleLayer: (id) =>
    get().commit((c) => ({
      ...c,
      layers: c.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),

  setActive: (id) =>
    set((s) => (s.doc ? { doc: { ...s.doc, canvas: { ...s.doc.canvas, activeLayerId: id } }, dirty: true } : {})),

  removeLayer: (id) =>
    get().commit((c) => {
      const layers = c.layers.filter((l) => l.id !== id);
      return { ...c, layers, activeLayerId: c.activeLayerId === id ? (layers.at(-1)?.id ?? null) : c.activeLayerId };
    }),
}));

/** 作品 Group 的句柄由 CanvasView 注册：视口缩放平移挂在这个节点上，导出要认它、而不是 Stage 视口 */
let artHandle: Konva.Group | null = null;
export const setArtHandle = (g: Konva.Group | null): void => {
  artHandle = g;
};
export const getArtHandle = (): Konva.Group | null => artHandle;
