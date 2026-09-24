import { docCanvasSchema, type DocCanvas } from '@retouch/shared';
import { all, db, nowIso, run } from '../db/index';
import { newDocId } from '../lib/ids';

export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  canvas: string;
  source_image_id: string | null;
  thumb_image_id: string | null;
  created_at: string;
  updated_at: string;
}

export function insertDocument(input: {
  userId: string;
  title: string;
  canvas: unknown;
  sourceImageId?: string | null;
}): DocumentRow {
  const canvas = docCanvasSchema.parse(input.canvas);
  const id = newDocId();
  const now = nowIso();
  run(
    `INSERT INTO documents (id, user_id, title, canvas, source_image_id, thumb_image_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    id,
    input.userId,
    input.title.slice(0, 60) || '未命名',
    JSON.stringify(canvas),
    input.sourceImageId ?? null,
    now,
    now,
  );
  return findDocument(id)!;
}

export function findDocument(id: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
}

export function listDocuments(userId: string, limit = 50): DocumentRow[] {
  return all<DocumentRow>('SELECT * FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?', userId, Math.min(limit, 200));
}

export function updateDocument(
  id: string,
  userId: string,
  patch: { title?: string; canvas?: unknown; thumbImageId?: string | null },
): DocumentRow | undefined {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title.slice(0, 60) || '未命名');
  }
  if (patch.canvas !== undefined) {
    sets.push('canvas = ?');
    args.push(JSON.stringify(docCanvasSchema.parse(patch.canvas)));
  }
  if (patch.thumbImageId !== undefined) {
    sets.push('thumb_image_id = ?');
    args.push(patch.thumbImageId);
  }
  if (!sets.length) return findDocument(id);
  sets.push('updated_at = ?');
  args.push(nowIso(), id, userId);
  run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, ...args);
  return findDocument(id);
}

export function deleteDocument(id: string, userId: string): boolean {
  return run('DELETE FROM documents WHERE id = ? AND user_id = ?', id, userId).changes === 1;
}

export function parseCanvas(row: DocumentRow): DocCanvas {
  return JSON.parse(row.canvas) as DocCanvas;
}
