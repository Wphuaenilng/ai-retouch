import { all, db, nowIso, run } from '../db/index';
import { newImageId } from '../lib/ids';

export interface ImageRow {
  id: string;
  user_id: string;
  kind: 'original' | 'edit' | 'result' | 'thumb' | 'mask';
  path: string;
  parent_task_id: string | null;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  created_at: string;
}

export function insertImage(input: {
  id?: string;
  userId: string;
  kind: ImageRow['kind'];
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  parentTaskId?: string | null;
}): ImageRow {
  const id = input.id ?? newImageId();
  run(
    `INSERT INTO images (id, user_id, kind, path, parent_task_id, width, height, bytes, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.userId,
    input.kind,
    input.path,
    input.parentTaskId ?? null,
    input.width,
    input.height,
    input.bytes,
    input.mime,
    nowIso(),
  );
  return findImage(id)!;
}

export function findImage(id: string): ImageRow | undefined {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow | undefined;
}

export function listImages(userId: string, opts: { kinds?: string[]; limit?: number } = {}): ImageRow[] {
  const limit = Math.min(opts.limit ?? 60, 200);
  if (opts.kinds?.length) {
    const marks = opts.kinds.map(() => '?').join(',');
    return all<ImageRow>(`SELECT * FROM images WHERE user_id = ? AND kind IN (${marks}) ORDER BY created_at DESC LIMIT ?`, userId, ...opts.kinds, limit);
  }
  return all<ImageRow>('SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);
}

export function deleteImage(id: string, userId: string): void {
  run('DELETE FROM images WHERE id = ? AND user_id = ?', id, userId);
}
