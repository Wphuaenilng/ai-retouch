import { baseCanvas, type DocCanvas, type DocumentDTO } from '@retouch/shared';
import { err } from '../lib/errors';
import { deleteDocument, findDocument, insertDocument, listDocuments, parseCanvas, updateDocument, type DocumentRow } from '../store/documents';
import { requireOwned } from './images';

export function toDTO(row: DocumentRow): DocumentDTO {
  return {
    id: row.id,
    title: row.title,
    canvas: parseCanvas(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbUrl: row.thumb_image_id ? `/api/images/${row.thumb_image_id}` : null,
  };
}

export function requireDoc(id: string, userId: string): DocumentRow {
  const row = findDocument(id);
  if (!row || row.user_id !== userId) throw err('NOT_FOUND', `文档 ${id} 不存在`);
  return row;
}

export function createDocument(userId: string, input: { title?: unknown; imageId: string; canvas?: DocCanvas }): DocumentDTO {
  const image = requireOwned(input.imageId, userId);
  const canvas = input.canvas ?? baseCanvas(image.width, image.height, image.id);
  return toDTO(
    insertDocument({ userId, title: input.title, canvas, sourceImageId: image.id }),
  );
}

export function createBlankDocument(userId: string, title = '新建项目'): DocumentDTO {
  const canvas = baseCanvas(1024, 1024, null, '空画布');
  return toDTO(insertDocument({ userId, title, canvas, sourceImageId: null }));
}

export function listDocs(userId: string): DocumentDTO[] {
  return listDocuments(userId).map(toDTO);
}

export function getDoc(id: string, userId: string): DocumentDTO {
  return toDTO(requireDoc(id, userId));
}

export function patchDoc(
  id: string,
  userId: string,
  patch: { title?: unknown; canvas?: unknown; thumbImageId?: unknown },
): DocumentDTO {
  const row = updateDocument(id, userId, { ...patch, thumbImageId: checkedThumb(patch.thumbImageId, userId) });
  if (!row) throw err('NOT_FOUND', `文档 ${id} 不存在`);
  return toDTO(row);
}

/** 封面必须是本人的一张图，否则就是往自己文档上挂别人的图片 id */
function checkedThumb(value: unknown, userId: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw err('BAD_REQUEST', 'thumbImageId 需要是字符串或 null');
  requireOwned(value, userId);
  return value;
}

export function removeDoc(id: string, userId: string): void {
  requireDoc(id, userId);
  deleteDocument(id, userId);
}

/** 从文档里取"当前图片"与"当前选区"，供 Agent 补全参数 */
export function docFacts(row: DocumentRow): {
  currentImageId: string | null;
  maskImageId: string | null;
  hasSelection: boolean;
  layerIds: string[];
  hasMultipleImages: boolean;
} {
  const canvas = parseCanvas(row);
  const imageIds = new Set(
    canvas.layers.map((l) => l.imageId).filter((x): x is string => typeof x === 'string' && x.length > 0),
  );
  const active = canvas.layers.find((l) => l.id === canvas.activeLayerId) ?? canvas.layers.at(-1);
  const maskLayer = [...canvas.layers].reverse().find((l) => l.kind === 'mask' && l.visible);
  const maskImageId = canvas.selection?.maskImageId ?? (maskLayer?.imageId ?? null);
  return {
    currentImageId: active?.imageId ?? canvas.sourceImageId ?? null,
    maskImageId: maskImageId ?? null,
    hasSelection: Boolean(maskImageId),
    layerIds: canvas.layers.map((l) => l.id),
    hasMultipleImages: imageIds.size > 1,
  };
}
