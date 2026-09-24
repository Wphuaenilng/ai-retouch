/**
 * 端到端冒烟：管理员 → 邀请码 → 注册 → 上传 → 文档 → 任务（含 SSE 事件）→ 结果下载
 * → 遮罩单独上传 + 选区消除 → 跨用户隔离 → Agent 多步计划 → 配额扣减 → 错误码稳定性。
 *
 * 前提：服务已启动，且 .env 里配了 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD。
 *   pnpm --filter @retouch/server dev
 *   pnpm --filter @retouch/server smoke
 */
import { Rgba } from '../src/lib/png';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787';
const ADMIN_USER = process.env.SMOKE_ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS ?? 'smoke-admin-123';

/** 内置占位图：不依赖仓库外的设计素材，克隆后即可跑 */
function smokeImage(): Buffer {
  const c = new Rgba(768, 512, [32, 34, 38, 255]);
  c.fillRect(0, 0, 768, 224, [58, 62, 70, 255]);
  c.fillRect(96, 160, 240, 240, [176, 108, 74, 255]);
  c.text(96, 72, '12345', [230, 226, 218, 255], 8);
  return c.toPng();
}
const IMAGE_BUF = smokeImage();

let cookie = '';
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  type Envelope = { ok?: boolean; data?: unknown; error?: { message?: string } };
  const json: Envelope = text ? (JSON.parse(text) as Envelope) : {};
  if (!res.ok || json.ok === false) throw new Error(`${res.status} ${path} ${json.error?.message ?? text.slice(0, 120)}`);
  return json as T;
}

const data = <T>(r: { data: T }): T => r.data;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 另开一个会话用（不碰全局 cookie），用来验证跨用户隔离 */
async function rawLogin(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

interface TaskDto {
  id: string;
  status: string;
  progress: number;
  resultImageId?: string | null;
  provider?: string | null;
  model?: string | null;
  error?: string | null;
}
interface PlanDto {
  id: string;
  status: string;
  cost_yuan: number;
  steps: { tool: string; status: string; costYuan?: number }[];
}

async function waitTask(id: string, ms = 90_000): Promise<TaskDto> {
  const end = Date.now() + ms;
  for (;;) {
    const r = data(await api<{ data: { task: TaskDto } }>(`/api/tasks/${id}`));
    if (['succeeded', 'failed', 'canceled'].includes(r.task.status)) {
      if (r.task.status !== 'succeeded') throw new Error(`任务失败：${r.task.error ?? r.task.status}`);
      return r.task;
    }
    if (Date.now() > end) throw new Error('等待任务超时');
    await sleep(400);
  }
}

async function waitPlan(id: string, ms = 90_000): Promise<PlanDto> {
  const end = Date.now() + ms;
  for (;;) {
    const list = data(await api<{ data: { plans: PlanDto[] } }>('/api/agent/plans'));
    const p = list.plans.find((x) => x.id === id);
    if (p && ['done', 'failed', 'canceled'].includes(p.status)) return p;
    if (Date.now() > end) throw new Error('等待计划超时');
    await sleep(400);
  }
}

/** 打开一条 SSE，把收到的事件类型收集起来 */
function openSse(): { events: string[]; stop: () => void } {
  const events: string[] = [];
  const ac = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { cookie }, signal: ac.signal });
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (;;) {
          const i = buf.indexOf('\n\n');
          if (i < 0) break;
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = /^data: (.*)$/m.exec(frame);
          if (m) {
            try {
              events.push((JSON.parse(m[1]) as { type: string }).type);
            } catch {
              /* 注释帧忽略 */
            }
          }
        }
      }
    } catch {
      /* abort */
    }
  })();
  return { events, stop: () => ac.abort() };
}

async function main(): Promise<void> {
  const health = data(await api<{ data: { status: string; providers: { id: string; available: boolean }[] } }>('/api/health'));
  check(
    '服务存活',
    health.status === 'up',
    `providers: ${health.providers.map((p) => `${p.id}${p.available ? '✓' : '✗'}`).join(' ')}`,
  );

  const anon = await api<{ data: unknown }>('/api/documents').then(
    () => null,
    (e: Error) => e.message,
  );
  check('未登录访问被拒', anon !== null && /401|登录/.test(anon ?? ''), anon ?? '竟然访问成功了');

  const adminLogin = data(
    await api<{ data: { me: { role: string } } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    }),
  );
  check('管理员登录', adminLogin.me.role === 'admin');

  const invite = data(
    await api<{ data: { codes: string[] } }>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ count: 1 }) }),
  );
  check('管理员生成邀请码', invite.codes.length === 1, invite.codes[0]);

  const username = `smoke_${Date.now().toString(36)}`;
  const reg = data(
    await api<{ data: { me: { id: string; quota: { limit: number } } } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: invite.codes[0], username, password: 'smoke-password-123' }),
    }),
  );
  check('邀请码注册并种下会话', Boolean(reg.me.id), `配额 ${reg.me.quota.limit}/天`);

  const reuse = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ inviteCode: invite.codes[0], username: 'another_one', password: 'smoke-password-123' }),
  }).then(
    () => null,
    (e: Error) => e.message,
  );
  check('邀请码一次性', typeof reuse === 'string' && /邀请码/.test(reuse as string), typeof reuse === 'string' ? reuse : '');

  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(IMAGE_BUF)], { type: 'image/png' }), 'portrait.png');
  const up = data(
    await api<{ data: { original: { id: string; width: number; height: number } } }>('/api/uploads', {
      method: 'POST',
      body: fd,
    }),
  );
  check('上传并落库', Boolean(up.original.id), `${up.original.width}×${up.original.height}`);

  const doc = data(
    await api<{ data: { document: { id: string } } }>('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title: '冒烟测试', imageId: up.original.id }),
    }),
  );
  check('创建文档', Boolean(doc.document.id));

  const sse = openSse();
  await sleep(400);

  const t1 = data(
    await api<{ data: { task: { id: string } } }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ tool: 'upscale', params: { imageId: up.original.id, scale: 2 }, documentId: doc.document.id }),
    }),
  );
  const done = await waitTask(t1.task.id);
  await sleep(400);
  check(
    '单工具任务跑通（mock 上游）',
    done.status === 'succeeded' && Boolean(done.resultImageId),
    `${done.provider}/${done.model}`,
  );
  check(
    'SSE 实时推送任务事件',
    sse.events.includes('task.queued') && sse.events.includes('task.succeeded'),
    [...new Set(sse.events)].join(' → ') || '一个事件都没收到',
  );
  sse.stop();

  const imgRes = await fetch(`${BASE}/api/images/${done.resultImageId}`, { headers: { cookie } });
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  check('结果图可下载', imgRes.ok && bytes.length > 1000, `${Math.round(bytes.length / 1024)}KB`);

  // —— 遮罩链路：画布涂完选区后只有 mask 可传，随后要能直接喂给消除任务
  const mfd = new FormData();
  mfd.append('mask', new Blob([new Uint8Array(IMAGE_BUF)], { type: 'image/png' }), 'mask.png');
  const maskUp = data(await api<{ data: { mask: { id: string } } }>('/api/uploads', { method: 'POST', body: mfd }));
  check('遮罩可单独上传（不带原图）', Boolean(maskUp.mask.id));

  const eraseTask = data(
    await api<{ data: { task: { id: string } } }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        tool: 'erase',
        params: { imageId: up.original.id, maskImageId: maskUp.mask.id },
        documentId: doc.document.id,
      }),
    }),
  );
  const erased = await waitTask(eraseTask.task.id);
  check('选区直连消除出图', Boolean(erased.resultImageId), `${erased.provider}/${erased.model}`);

  // —— 跨用户隔离：第二个账号取别人的图必须被拒（以前的用例不带 cookie，只证明了未登录被拒）
  const userCookie = cookie;
  const adminCookie = await rawLogin(ADMIN_USER, ADMIN_PASS);
  const inv2Res = await fetch(`${BASE}/api/admin/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ count: 1 }),
  });
  const inv2 = (await inv2Res.json()) as { data?: { codes?: string[] } };
  const code2 = inv2.data?.codes?.[0] ?? '';
  const regB = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: code2, username: `smoke_b_${Date.now().toString(36)}`, password: 'smoke-password-123' }),
  });
  const bCookie = (regB.headers.get('set-cookie') ?? '').split(';')[0];
  const cross = await fetch(`${BASE}/api/images/${up.original.id}`, { headers: { cookie: bCookie } });
  check('跨用户取他人图片被拒（403）', cross.status === 403, `HTTP ${cross.status}`);
  const noAuth = await fetch(`${BASE}/api/images/${up.original.id}`);
  check('未登录取图片被拒（401）', noAuth.status === 401, `HTTP ${noAuth.status}`);
  cookie = userCookie;

  const plan = data(
    await api<{ data: { plan: { id: string; steps: { tool: string }[] } } }>('/api/agent/plans', {
      method: 'POST',
      body: JSON.stringify({ documentId: doc.document.id, message: '把背景换成纯白，然后超分到 2 倍' }),
    }),
  );
  check('Agent 产出两步计划', plan.plan.steps.length === 2, plan.plan.steps.map((s) => s.tool).join(' → '));

  const approved = data(
    await api<{ data: { plan: { id: string } } }>(`/api/agent/plans/${plan.plan.id}/approve`, { method: 'POST' }),
  );
  const finished = await waitPlan(approved.plan.id);
  check(
    'Agent 顺序执行并传递中间结果',
    finished.status === 'done' && finished.steps.every((s) => s.status === 'succeeded'),
    finished.steps.map((s) => `${s.tool}:${s.status}`).join(' '),
  );

  const quota = data(await api<{ data: { me: { quota: { used: number; costTodayYuan: number } } } }>('/api/me'));
  check('配额与成本已记账', quota.me.quota.used >= 3, `今日 ${quota.me.quota.used} 次 / ¥${quota.me.quota.costTodayYuan}`);

  const badTool = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ tool: 'make_video', params: {} }) }).then(
    () => null,
    (e: Error) => e.message,
  );
  check('未知工具被拒', typeof badTool === 'string' && /没有这个工具/.test(badTool as string));

  const needMask = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ tool: 'erase', params: { imageId: up.original.id } }),
  }).then(
    () => null,
    (e: Error) => e.message,
  );
  check('缺选区时报稳定的业务错误', typeof needMask === 'string' && /涂抹|框选/.test(needMask as string));

  const impossible = await api('/api/agent/plans', {
    method: 'POST',
    body: JSON.stringify({ documentId: doc.document.id, message: '把这张图做成 15 秒视频' }),
  }).then(
    () => null,
    (e: Error) => e.message,
  );
  check('做不到的需求被明确拒绝', typeof impossible === 'string' && /做不到/.test(impossible as string));

  const forbidden = await api('/api/admin/overview').then(
    () => null,
    (e: Error) => e.message,
  );
  check('普通用户访问管理端被拒', forbidden !== null && /403|管理员/.test(forbidden ?? ''), forbidden ?? '');

  const relogin = await api<{ data: { me: { role: string } } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const overview = data(
    await api<{ data: { totals: { tasks: number; users: number }; costTodayYuan: number; worker: { concurrency: number } } }>(
      '/api/admin/overview',
    ),
  );
  check(
    '切回管理员会话后概览可读',
    relogin.data.me.role === 'admin' && typeof overview.totals.tasks === 'number',
    `任务 ${overview.totals.tasks} · 用户 ${overview.totals.users} · 今日 ¥${overview.costTodayYuan}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('冒烟测试异常：', e instanceof Error ? e.message : e);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(1);
});
