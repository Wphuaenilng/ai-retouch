/**
 * 内置测试图（上手性 · 首屏样例）。
 * 这三张 PNG 是**提交进仓库的产物**，所以这里主要钉两件事：
 * 文件还在且能被解码（被人误删或改坏时，导入会在运行时才炸）；
 * 以及导入出来的图归属正确、走的是和上传完全同一条落盘路径。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rt-samples-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 's.db');
process.env.DATA_DIR = dir;

// config 必须在 env 设好之后再拿：静态 import 会被提升，那样 SQLITE_PATH 读到的是
// 默认值 data/retouch.db —— 也就是开发机的真实库，而且 NODE_ENV 还不是 test，
// config 里那道护栏也不会响。这个坑踩过一次（D 表里"测试打开真实库"那条）。
const { ROOT } = await import('../src/config');
const { closeDb } = await import('../src/db/index');
const { migrate } = await import('../src/db/migrate');
const { listSamples, readSample, importSample } = await import('../src/services/samples');
const { sniffImage } = await import('../src/lib/imagedims');
const { findImage } = await import('../src/store/images');

migrate();

after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const DIR = join(ROOT, 'apps/server/assets/samples');

describe('清单', () => {
  it('三张，id 稳定，每张都说清是给哪类功能看的', () => {
    const list = listSamples();
    assert.deepEqual(
      list.map((s) => s.id),
      ['edges', 'ramp', 'marks'],
    );
    for (const s of list) {
      assert.ok(s.label.length > 0 && s.note.length > 0, `${s.id} 缺说明`);
      assert.ok(existsSync(join(DIR, `${s.id}.png`)), `${s.id}.png 没入库`);
    }
  });
});

describe('文件', () => {
  it('读出来是能被解码的 PNG，且尺寸与生成器一致（800×600）', () => {
    for (const id of ['edges', 'ramp', 'marks']) {
      const buf = readSample(id);
      assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${id} 不是 PNG`);
      const info = sniffImage(buf);
      assert.ok(info, `${id} 解不出来`);
      assert.equal(info?.width, 800);
      assert.equal(info?.height, 600);
    }
  });

  it('不存在的 id 报 NOT_FOUND，而不是把路径拼出去读', () => {
    assert.throws(
      () => readSample('../../etc/passwd'),
      (e: unknown) => (e as { code?: string }).code === 'NOT_FOUND',
    );
    assert.throws(
      () => readSample('nope'),
      (e: unknown) => (e as { code?: string }).code === 'NOT_FOUND',
    );
  });
});

describe('导入', () => {
  it('落成该用户的一张 original，文件在用户目录下', async () => {
    const row = await importSample('edges', 'us_sample_a');
    assert.equal(row.kind, 'original');
    assert.equal(row.user_id, 'us_sample_a');
    assert.equal(row.width, 800);
    assert.ok(existsSync(row.path), '文件应当已落盘');
    assert.ok(row.path.includes(join('images', 'us_sample_a')), `路径该在用户目录里，实得 ${row.path}`);
    assert.equal(findImage(row.id)?.id, row.id);

    // 同一张图导入两次是两条独立记录（各归各的），不共享路径
    const again = await importSample('edges', 'us_sample_b');
    assert.notEqual(again.path, row.path);
    assert.equal(again.user_id, 'us_sample_b');
  });
});
