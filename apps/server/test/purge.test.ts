/**
 * 删除是不是真的删干净（任务 5.8 / D19）。
 * 关键不在于"行没了"，而在于**引用不能留着**：画布上还指着一个已删的 imageId，
 * 用户下次打开就是加载失败的图层；文件留在盘上，就是隐私承诺没兑现。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { baseCanvas } from '@retouch/shared';
import type { ImageRow } from '../src/store/images';
import { Rgba } from '../src/lib/png';

const dir = mkdtempSync(join(tmpdir(), 'rt-purge-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'p.db');
process.env.DATA_DIR = dir;

const { db, closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const { purgeImages, saveImage } = await import('../src/services/images');
const { removeDoc } = await import('../src/services/documents');

migrate();

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const USER = 'us_purge';
type Arg = string | number | null;
const png = (w: number): Buffer => new Rgba(w, Math.max(1, w >> 1), [10, 20, 30, 255]).toPng();
const count = (sql: string, ...args: Arg[]): number => Number((db.prepare(sql).get(...args) as { n: number | bigint }).n);
const rowOf = (id: string): ImageRow => db.prepare('SELECT * FROM images WHERE id = ?').get(id) as unknown as ImageRow;
const colOf = (sql: string, ...args: Arg[]): unknown => Object.values(db.prepare(sql).get(...args) as Record<string, unknown>)[0];

describe('删一张图', () => {
  it('文件、行、同一次上传的派生件一起走', async () => {
    const original = await saveImage({ userId: USER, kind: 'original', buf: png(64) });
    const edit = await saveImage({ userId: USER, kind: 'edit', buf: png(32), parentImageId: original.id });
    const thumb = await saveImage({ userId: USER, kind: 'thumb', buf: png(8), parentImageId: original.id });
    const paths = [original.path, edit.path, thumb.path];
    paths.forEach((p) => assert.ok(existsSync(p), '上传后文件应当在'));

    const derived = db.prepare('SELECT * FROM images WHERE parent_image_id = ?').all(original.id) as unknown as ImageRow[];
    const r = await purgeImages([rowOf(original.id), ...derived], USER);

    assert.equal(r.images, 3, '派生件要跟着一起删');
    assert.equal(count('SELECT COUNT(*) n FROM images WHERE user_id = ?', USER), 0);
    paths.forEach((p) => assert.ok(!existsSync(p), `文件应已删掉：${p}`));
  });

  it('画布与任务上的引用被摘掉，任务行本身留着（那是账本）', async () => {
    const src = await saveImage({ userId: USER, kind: 'original', buf: png(48) });
    const product = await saveImage({ userId: USER, kind: 'result', buf: png(24) });
    const base = baseCanvas(48, 24, src.id);
    const doc = insertDoc(src.id, { ...base, layers: [...base.layers, { ...base.layers[0], id: 'L2', imageId: product.id }] });
    db.prepare(
      `INSERT INTO tasks (id, user_id, document_id, tool, status, progress, input, image_id, result_image_id, cost_yuan, attempts, charged, created_at)
       VALUES ('tk_p1', ?, ?, 'cutout', 'succeeded', 1, '{}', ?, ?, 0.03, 1, 1, ?)`,
    ).run(USER, doc, src.id, product.id, new Date().toISOString());

    await purgeImages([rowOf(product.id)], USER);

    const canvas = JSON.parse(colOf('SELECT canvas FROM documents WHERE id = ?', doc) as string) as {
      layers: { imageId?: string }[];
    };
    assert.deepEqual(
      canvas.layers.map((l) => l.imageId),
      [src.id],
      '只剩没被删的那层',
    );
    assert.equal(count("SELECT COUNT(*) n FROM tasks WHERE id = 'tk_p1'"), 1, '任务行是账本，不该跟着删');
    assert.equal(colOf('SELECT result_image_id FROM tasks WHERE id = ?', 'tk_p1'), null);
  });
});

describe('删项目', () => {
  it('带走本项目的产物，但不带走可能被别的项目共用的原图', async () => {
    const src = await saveImage({ userId: USER, kind: 'original', buf: png(40) });
    const a = insertDoc(src.id);
    const b = insertDoc(src.id);
    db.prepare(
      "INSERT INTO tasks (id, user_id, document_id, tool, status, progress, input, created_at) VALUES ('tk_p2', ?, ?, 'cutout', 'succeeded', 1, '{}', ?)",
    ).run(USER, a, new Date().toISOString());
    const product = await saveImage({ userId: USER, kind: 'result', buf: png(20), parentTaskId: 'tk_p2' });

    const r = await removeDoc(a, USER);

    assert.ok(r.images >= 1, '项目产物应当被删掉');
    assert.equal(count('SELECT COUNT(*) n FROM documents WHERE id = ?', a), 0);
    assert.equal(count('SELECT COUNT(*) n FROM images WHERE id = ?', product.id), 0);
    assert.ok(existsSync(src.path), '原图还在：另一个项目还在用它');
    assert.equal(count('SELECT COUNT(*) n FROM documents WHERE id = ?', b), 1, '别的项目不该被牵连');
  });
});

/** 直接建文档：insertDocument 的入参形状与画布一起写在这里，测试才自解释 */
function insertDoc(sourceImageId: string, canvas?: unknown): string {
  const id = `dc_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO documents (id, user_id, title, canvas, source_image_id, created_at, updated_at)
     VALUES (?, ?, '测试', ?, ?, ?, ?)`,
  ).run(
    id,
    USER,
    JSON.stringify(canvas ?? baseCanvas(40, 20, sourceImageId)),
    sourceImageId,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  return id;
}
