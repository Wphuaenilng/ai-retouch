/**
 * 内容审核的故障取向（D17）。
 * 规则是一条产品决策，不是实现细节：审核服务自己挂了的时候，**成品图不出图**（要发给
 * 别人看的那一张宁停不错发），**上传放行**（上游抖一下不该把所有人的工作台锁死）。
 * 写成测试是为了下一个人不会把两处一起"顺手改成放行"。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { ImageRow } from '../src/store/images';

const dir = mkdtempSync(join(tmpdir(), 'rt-mod-'));
process.env.NODE_ENV = 'test';
process.env.MODERATION = 'qwen-vl';
// config 只在 import 时读一次 env，所以自定义词表要在动态 import 之前放好
process.env.MODERATION_BLOCK_WORDS = '内部测试词';

const { checkPrompt, checkImage, assertImageSafe } = await import('../src/services/moderation');

const file = join(dir, 'x.png');
writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const ROW: ImageRow = {
  id: 'im_mod',
  user_id: 'us_mod',
  kind: 'result',
  path: file,
  parent_task_id: null,
  width: 1,
  height: 1,
  bytes: 4,
  mime: 'image/png',
  created_at: new Date().toISOString(),
};

const realFetch = globalThis.fetch;
const restore = (): void => {
  globalThis.fetch = realFetch;
};

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

after(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

describe('审核故障时的取向', () => {
  it('请求抛异常：上传放行、成品拒绝，且错误码说"服务不可用"而不是"违规"', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    });
    assert.equal((await checkImage(ROW, 'upload')).safe, true);
    assert.equal((await checkImage(ROW, 'result')).safe, false);
    assert.equal(await code(() => assertImageSafe(ROW, 'result')), 'MODERATION_UNAVAILABLE');
    restore();
  });

  it('上游 5xx 与返回读不懂算同一类：都不放行成品', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 503 }));
    assert.equal((await checkImage(ROW, 'result')).degraded, true);
    globalThis.fetch = (async () => new Response('not json at all', { status: 200 }));
    assert.equal((await checkImage(ROW, 'result')).degraded, true);
    assert.equal(await code(() => assertImageSafe(ROW, 'result')), 'MODERATION_UNAVAILABLE');
    restore();
  });

  it('真判定为违规时给 MODERATION_REJECTED，两个阶段都挡', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ safe: false, reason: '涉黄' }) } }] });
    globalThis.fetch = (async () => new Response(body, { status: 200 }));
    assert.equal((await checkImage(ROW, 'result')).safe, false);
    assert.equal((await checkImage(ROW, 'result')).degraded, undefined);
    assert.equal(await code(() => assertImageSafe(ROW, 'upload')), 'MODERATION_REJECTED');
    restore();
  });

  it('判定通过就放行', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ safe: true }) } }] });
    globalThis.fetch = (async () => new Response(body, { status: 200 }));
    assert.equal((await checkImage(ROW, 'result')).safe, true);
    restore();
  });
});

function promptCode(prompt: string): string | undefined {
  try {
    checkPrompt(prompt);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe('提示词关键词表可配置', () => {
  it('配了就用配的，而且是整表替换', () => {
    assert.equal(promptCode('里面有内部测试词'), 'MODERATION_REJECTED');
    // 默认名单里的词不再命中 —— 这是"替换"而非"追加"的可观察证据
    assert.equal(promptCode('把这张 色情 裸露 枪支 风格的图调亮'), undefined);
  });

  it('空提示词不拦', () => {
    assert.equal(promptCode(''), undefined);
  });
});
