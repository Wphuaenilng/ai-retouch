/**
 * 万相 2.6 适配器（wanx）。
 * 这个文件存在的理由很具体：老写法按"input.prompt + 提交任务 + 轮询"发，真 key 一打就 400，
 * 而单测一个都没有，所以它坏了很久没人知道。这里钉住的是**请求体形状**与**结果字段位置**，
 * 都用 stub fetch，不联网、不花钱。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'rt-wanxtest-'));
process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = join(dir, 'w.db');
process.env.DATA_DIR = dir;
process.env.PROVIDER_PRIORITY = 'wanx,mock';
process.env.DASHSCOPE_API_KEY = 'sk-test';

const { wanxProvider } = await import('../src/providers/wanx');
const { chainFor } = await import('../src/providers/registry');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

interface Sent {
  url: string;
  body: Record<string, unknown>;
  async: string;
}
let sent: Sent[] = [];

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** 2.6 是同步端点：一发请求直接回图，没有 task_id 也没有轮询 */
function repliesWith(payload: unknown): typeof fetch {
  return async (input, init) => {
    sent.push({
      url: urlOf(input),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
      async: String((init?.headers as Record<string, string>)['X-DashScope-Async'] ?? ''),
    });
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const succeeded = (image: string) => ({
  output: {
    finished: true,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ type: 'image', image }] } }],
  },
  usage: { image_count: 1, size: '1024*1024' },
});

const T2I = { capability: 'text2image' as const, prompt: '白瓷杯', images: [] };
const EDIT = { capability: 'edit' as const, prompt: '换深色木桌', images: [{ base64: DATA_URL, mime: 'image/png' }] };

describe('请求形状', () => {
  it('走同步的 multimodal-generation，prompt 在 messages.content 里，不带异步头', async () => {
    sent = [];
    globalThis.fetch = repliesWith(succeeded(DATA_URL));
    const r = await wanxProvider.generate({ ...T2I, size: { width: 1024, height: 768 }, count: 2 });

    assert.equal(sent[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(sent[0].async, '', '2.6 同步出图，发异步头反而会拿到 task_id');
    assert.deepEqual(sent[0].body.input, { messages: [{ role: 'user', content: [{ text: '白瓷杯' }] }] });
    assert.deepEqual(sent[0].body.parameters, { size: '1024*768', n: 2, watermark: false });
    assert.equal((sent[0].body.model as string).startsWith('wan2.6'), true);
    assert.equal(r.provider, 'wanx');
    assert.equal(r.costYuan, 0.2, '要了 2 张但只回 1 张：记账按真返回的张数');
  });

  it('编辑：输入图当 content 项传，并关掉图文混排', async () => {
    sent = [];
    globalThis.fetch = repliesWith(succeeded(DATA_URL));
    await wanxProvider.generate(EDIT);

    const content = (sent[0].body.input as { messages: { role: string; content: unknown[] }[] }).messages[0].content as Record<
      string,
      unknown
    >[];
    assert.deepEqual(content, [{ text: '换深色木桌' }, { image: DATA_URL }], 'dataURL 直接给上游，它收');
    assert.equal((sent[0].body.parameters as Record<string, unknown>).enable_interleave, false);
  });

  it('尺寸按上游上限 2048 收口，不然大图直接被拒', async () => {
    sent = [];
    globalThis.fetch = repliesWith(succeeded(DATA_URL));
    await wanxProvider.generate({ ...T2I, size: { width: 6000, height: 4000 } });
    assert.equal((sent[0].body.parameters as Record<string, unknown>).size, '2048*2048');
  });
});

describe('结果解析', () => {
  it('图在 choices[].message.content[].image，回 URL 时把字节拉下来', async () => {
    globalThis.fetch = async (input) => {
      if (typeof input === 'string' && input.includes('/multimodal-generation/')) {
        return new Response(JSON.stringify(succeeded('https://dashscope-result.example/a.png')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const r = await wanxProvider.generate(T2I);
    assert.equal(r.images[0].base64, DATA_URL);
    assert.equal(r.images[0].mime, 'image/png');
  });

  it('200 但只有文字 / 顶层带 code / 空 choices，三种都要报而不是出空图', async () => {
    globalThis.fetch = repliesWith({
      output: { finished: true, choices: [{ message: { content: [{ type: 'text', text: '抱歉，我无法生成' }] } }] },
    });
    await assert.rejects(() => wanxProvider.generate(T2I), /抱歉，我无法生成/);

    globalThis.fetch = repliesWith({ code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded' });
    await assert.rejects(() => wanxProvider.generate(T2I), /rate limit/);

    globalThis.fetch = repliesWith({ output: { finished: true, choices: [] } });
    await assert.rejects(() => wanxProvider.generate(T2I), /未返回图片/);
  });
});

describe('能力声明按实测收口', () => {
  it('只声明 text2image 与 edit：遮罩会被上游拒，超分抠图是别的模型', () => {
    assert.deepEqual(wanxProvider.capabilities, ['text2image', 'edit']);
    assert.equal(
      chainFor('inpaint').some((p) => p.id === 'wanx'),
      false,
      '消除不该派给万相',
    );
    assert.equal(
      chainFor('upscale').some((p) => p.id === 'wanx'),
      false,
    );
    assert.equal(chainFor('text2image').map((p) => p.id)[0], 'wanx');
  });
});
