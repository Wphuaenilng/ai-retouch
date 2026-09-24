import { all, db, nowIso, run } from '../db/index';
import { newImageId } from '../lib/ids';

export interface ImageRow {
  id: string;
  user_id: string;
  kind: 'original' | 'edit' | 'result' | 'thumb' | 'mask';
  path: string;
  parent_task_id: string | null;
  /** 同一次上传里由谁派生（edit/thumb 认 original）；迁移 #5 之前的行是 NULL */
  parent_image_id: string | null;
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
  /** 同一次上传里由谁派生：edit/thumb 认 original。老数据是 NULL，删除时只删自己 */
  parentImageId?: string | null;
}): ImageRow {
  const id = input.id ?? newImageId();
  run(
    `INSERT INTO images (id, user_id, kind, path, parent_task_id, parent_image_id, width, height, bytes, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.userId,
    input.kind,
    input.path,
    input.parentTaskId ?? null,
    input.parentImageId ?? null,
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

export function listImages(userId: string, opts: { kinds?: string[]; limit?: number; documentId?: string } = {}): ImageRow[] {
  const limit = Math.min(opts.limit ?? 60, 200);
  const where = ['user_id = ?'];
  const args: unknown[] = [userId];
  if (opts.kinds?.length) {
    where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
    args.push(...opts.kinds);
  }
  if (opts.documentId) {
    // 接触印样要按项目取：本项目的任务产物 + 该文档的来源图与封面
    where.push(
      `(parent_task_id IN (SELECT id FROM tasks WHERE document_id = ?)
        OR id IN (SELECT source_image_id FROM documents WHERE id = ?
                  UNION SELECT thumb_image_id FROM documents WHERE id = ?))`,
    );
    args.push(opts.documentId, opts.documentId, opts.documentId);
  }
  return all<ImageRow>(`SELECT * FROM images WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, ...args, limit);
}

export function deleteImage(id: string, userId: string): void {
  run('DELETE FROM images WHERE id = ? AND user_id = ?', id, userId);
}

/** 一次上传的派生件：删原图时不该把它的编辑副本与缩略图留在盘上 */
export function findDerived(userId: string, parentId: string): ImageRow[] {
  return all<ImageRow>('SELECT * FROM images WHERE user_id = ? AND parent_image_id = ?', userId, parentId);
}
