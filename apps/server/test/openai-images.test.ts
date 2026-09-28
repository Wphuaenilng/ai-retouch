/**
 * gpt-image 适配器（openai_images）。
 * 钉住的是**我们发出去的请求形状**与**只声明文生图**这两件事：中转站报 400 时先对照这里，
 * 别从业务层开始怀疑。上游用 stub fetch，不联网。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rt-gptimg-'));
process.env.NODE_ENV = 'test';
// config 只在 import 时读一次 env，所以这些都要在动态 import 之前放好
process.env.SQLITE_PATH = join(dir, 'gptimg.db');
process.env.DATA_DIR = dir;
process.env.PROVIDER_PRIORITY = 'openai_images,mock';
process.env.OPENAI_IMAGES_API_KEY = 'sk-relay-test';
process.env.OPENAI_IMAGES_BASE_URL = 'https://relay.invalid/v1';
process.env.OPENAI_IMAGES_MODEL = 'gpt-image-2';
process.env.OPENAI_IMAGES_QUALITY = 'high';
process.env.OPENAI_IMAGES_PRICE_YUAN = '0.9';

const { openaiImagesProvider, snapSize } = await import('../src/providers/openai_images');
const { chainFor } = await import('../src/providers/registry');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_B64 = PNG.toString('base64');

interface Sent {
  url: string;
  body: Record<string, unknown>;
  auth: string;
}
let sent: Sent[] = [];

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

function repliesWith(payload: unknown): typeof fetch {
  return async (input, init) => {
    sent.push({
      url: urlOf(input),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
      auth: String((init?.headers as Record<string, string>).authorization ?? ''),
    });
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const T2I = { capability: 'text2image' as const, prompt: '晨光里的手冲咖啡', images: [] };

describe('尺寸吸附', () => {
  it('gpt-image 只认三档，非标准比例就近吸附', () => {
    assert.equal(snapSize(1024, 1024).label, '1024x1024');
    assert.equal(snapSize(1024, 576).label, '1536x1024', '16:9 该吸到 3:2');
    assert.equal(snapSize(1024, 768).label, '1536x1024', '4:3 比 1:1 更接近 3:2');
    assert.equal(snapSize(768, 1024).label, '1024x1536');
    assert.equal(snapSize(4000, 900).label, '1536x1024', '极端横条也逃不出这三档');
  });

  it('返回的宽高与 label 自洽，调用方拿它对得上', () => {
    const s = snapSize(1024, 576);
    assert.equal(`${s.width}x${s.height}`, s.label);
  });
});

describe('出请求', () => {
  it('按官方 spec：端点、字段、Bearer，计费按返回张数', async () => {
    sent = [];
    globalThis.fetch = repliesWith({ data: [{ b64_json: PNG_B64 }], usage: { total_tokens: 1200 } });
    const r = await openaiImagesProvider.generate({ ...T2I, size: { width: 1024, height: 576 }, count: 2 });

    assert.equal(sent[0].url, 'https://relay.invalid/v1/images/generations');
    assert.equal(sent[0].auth, 'Bearer sk-relay-test');
    assert.deepEqual(sent[0].body, {
      model: 'gpt-image-2',
      prompt: '晨光里的手冲咖啡',
      n: 2,
      size: '1536x1024',
      quality: 'high',
    });
    assert.equal(r.provider, 'openai_images');
    assert.equal(r.model, 'gpt-image-2');
    assert.equal(r.images.length, 1);
    assert.equal(r.costYuan, 0.9, '元/张取配置值，且只按真返回的张数算');
  });

  it('中转站回 URL 时也把字节拉下来（落盘只认 base64）', async () => {
    globalThis.fetch = async (input) => {
      if (urlOf(input).endsWith('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://relay.invalid/p.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const r = await openaiImagesProvider.generate(T2I);
    assert.equal(r.images[0].base64, `data:image/png;base64,${PNG_B64}`);
  });

  it('HTTP 400 与 200 里带 error 都抛 UpstreamError，不出空图', async () => {
    globalThis.fetch = async () => new Response('{"error":{"message":"model not found"}}', { status: 400 });
    await assert.rejects(() => openaiImagesProvider.generate(T2I), /上游返回 400/);

    globalThis.fetch = repliesWith({ error: { message: 'quality 参数不支持' }, data: [] });
    await assert.rejects(() => openaiImagesProvider.generate(T2I), /quality 参数不支持/);

    globalThis.fetch = repliesWith({ data: [] });
    await assert.rejects(() => openaiImagesProvider.generate(T2I), /未返回图片/);
  });
});

describe('能力声明', () => {
  it('只有 text2image：消除类任务不会被派给它', () => {
    assert.deepEqual(openaiImagesProvider.capabilities, ['text2image']);
    assert.equal(openaiImagesProvider.available, true);

    const t2i = chainFor('text2image').map((p) => p.id);
    assert.ok(t2i.includes('openai_images'), `文生图链该有它，实得 ${t2i.join(',')}`);
    const inpaint = chainFor('inpaint').map((p) => p.id);
    assert.ok(!inpaint.includes('openai_images'), `消除不该轮到它，实得 ${inpaint.join(',')}`);
  });
});
