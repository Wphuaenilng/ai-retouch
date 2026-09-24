import type { ImageDTO, ImageRef } from '@retouch/shared';
import { config } from '../config';
import { err } from '../lib/errors';
import { sniffImage } from '../lib/imagedims';
import { putImage, readImage } from '../lib/storage';
import { newImageId } from '../lib/ids';
import { findImage, insertImage, type ImageRow } from '../store/images';

/** 校验 + 落盘 + 建行，三件事必须在一起，避免有记录没文件 */
export async function saveImage(input: {
  userId: string;
  kind: 'original' | 'edit' | 'result' | 'thumb' | 'mask';
  buf: Buffer;
  parentTaskId?: string | null;
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
  });
}

export function requireOwned(id: string, userId: string): ImageRow {
  const row = findImage(id);
  if (!row || row.user_id !== userId) throw err('NOT_FOUND', `图片 ${id} 不存在`);
  return row;
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
