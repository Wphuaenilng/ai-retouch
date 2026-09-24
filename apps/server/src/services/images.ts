import type { DocCanvas, ImageDTO, ImageRef } from '@retouch/shared';
import { config } from '../config';
import { run } from '../db/index';
import { err } from '../lib/errors';
import { sniffImage } from '../lib/imagedims';
import { putImage, readImage, removeImage } from '../lib/storage';
import { newImageId } from '../lib/ids';
import { listDocuments, parseCanvas, updateDocument } from '../store/documents';
import { findImage, insertImage, type ImageRow } from '../store/images';

/** 校验 + 落盘 + 建行，三件事必须在一起，避免有记录没文件 */
export async function saveImage(input: {
  userId: string;
  kind: 'original' | 'edit' | 'result' | 'thumb' | 'mask';
  buf: Buffer;
  parentTaskId?: string | null;
  parentImageId?: string | null;
}): Promise<ImageRow> {
  if (input.buf.length > config.maxUploadBytes) {
    throw err('FILE_TOO_LARGE', `单张最大 ${config.MAX_UPLOAD_MB}MB`);
  }
  const info = sniffImage(input.buf);
  if (!info) throw err('FILE_TYPE_UNSUPPORTED', '只接受 PNG / JPEG / WebP / GIF');
  if (info.width * info.height > 40_000_000) throw err('FILE_TOO_LARGE', '像素总量超过 4000 万，请先缩小');

  const id = newImageId();
  const path = await putImage(input.userId, id, info.mime, input.buf);
  return insertImage({
    id,
    userId: input.userId,
    kind: input.kind,
    path,
    mime: info.mime,
    width: info.width,
    height: info.height,
    bytes: input.buf.length,
    parentTaskId: input.parentTaskId ?? null,
    parentImageId: input.parentImageId ?? null,
  });
}

export function requireOwned(id: string, userId: string): ImageRow {
  const row = findImage(id);
  if (!row || row.user_id !== userId) throw err('NOT_FOUND', `图片 ${id} 不存在`);
  return row;
}

/**
 * 删除的完整含义：文件、行、以及所有指着它的引用。
 * 只删行会把脏数据留在用户眼前 —— 画布上留着取不到的图层、印样里留着点开就 404 的缩略图。
 *
 * 引用有三处：documents 的 source/thumb 列与画布里那些图层的 imageId，
 * 以及 tasks 的 result/mask 列。任务行本身**保留**：那是账本，删账本会把
 * usage_daily 与真实花费对不上（成本审计比"历史干净"值钱），只把指向已删图片的列清空。
 */
export async function purgeImages(rows: ImageRow[], userId: string): Promise<{ images: number; files: number }> {
  if (!rows.length) return { images: 0, files: 0 };
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');

  let files = 0;
  for (const r of rows) {
    await removeImage(r.path);
    files += 1;
  }
  run(`DELETE FROM images WHERE user_id = ? AND id IN (${ph})`, userId, ...ids);
  run(
    `UPDATE tasks SET result_image_id = NULL, mask_image_id = NULL WHERE user_id = ? AND (result_image_id IN (${ph}) OR mask_image_id IN (${ph}))`,
    userId,
    ...ids,
    ...ids,
  );
  run(`UPDATE documents SET source_image_id = NULL WHERE user_id = ? AND source_image_id IN (${ph})`, userId, ...ids);
  run(`UPDATE documents SET thumb_image_id = NULL WHERE user_id = ? AND thumb_image_id IN (${ph})`, userId, ...ids);
  scrubCanvases(userId, new Set(ids));
  return { images: ids.length, files };
}

/** 把引用了已删图片的图层从画布里剥掉；活动层被剥走时一并清掉 activeLayerId */
function scrubCanvases(userId: string, gone: Set<string>): void {
  for (const doc of listDocuments(userId, 200)) {
    let canvas: DocCanvas;
    try {
      canvas = parseCanvas(doc);
    } catch {
      continue; // 画布本身已经坏了，不在这次删除的责任范围
    }
    const layers = canvas.layers.filter((l) => !('imageId' in l) || !gone.has(l.imageId as string));
    if (layers.length === canvas.layers.length) continue;
    const activeGone = canvas.activeLayerId && !layers.some((l) => l.id === canvas.activeLayerId);
    updateDocument(doc.id, userId, {
      canvas: {
        ...canvas,
        layers,
        activeLayerId: activeGone ? undefined : canvas.activeLayerId,
        selection: canvas.selection?.maskImageId && gone.has(canvas.selection.maskImageId) ? null : canvas.selection,
      },
    });
  }
}

export async function loadBuffer(row: ImageRow): Promise<Buffer> {
  try {
    return await readImage(row.path);
  } catch {
    throw err('NOT_FOUND', '图片文件已丢失，请重新上传');
  }
}

export async function toProviderRef(row: ImageRow): Promise<ImageRef> {
  const buf = await loadBuffer(row);
  return { base64: `data:${row.mime};base64,${buf.toString('base64')}`, mime: row.mime };
}

export function toDTO(row: ImageRow): ImageDTO {
  return {
    id: row.id,
    kind: row.kind,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    mime: row.mime,
    url: `/api/images/${row.id}`,
    createdAt: row.created_at,
  };
}
