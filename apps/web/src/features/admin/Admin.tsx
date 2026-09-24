import { useEffect, useState, type ReactElement } from 'react';
import { api, errorText } from '../../lib/api';
import { Icon } from '../../ui/Icon';

interface Overview {
  totals: { users: number; tasks: number; failedTasks: number; images: number; freeInvites: number };
  costTodayYuan: number;
  budgetYuan: number;
  worker: { running: number; concurrency: number };
  providers: { id: string; label: string; available: boolean; capabilities: string[] }[];
  moderation: string;
}
interface AdminUser {
  id: string;
  username: string;
  role: string;
  quotaPerDay: number;
  quota: { used: number; remaining: number; costTodayYuan: number };
}
interface Invite {
  code: string;
  used_by: string | null;
  expires_at: string | null;
  created_at: string;
}

/** 只到日：管理员要的是"这个月内还有效吗"，不是秒 */
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

export function AdminPage(): ReactElement {
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [validDays, setValidDays] = useState(30);
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    try {
      const [a, b, c] = await Promise.all([
        api.get<Overview>('/api/admin/overview'),
        api.get<{ users: AdminUser[] }>('/api/admin/users'),
        api.get<{ invites: Invite[] }>('/api/admin/invites'),
      ]);
      setOv(a);
      setUsers(b.users);
      setInvites(c.invites);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const mint = async (): Promise<void> => {
    try {
      const r = await api.post<{ codes: string[] }>('/api/admin/invites', { count: 3, validDays });
      setCodes((c) => [...r.codes, ...c]);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  // 没用掉的码才是待发出去的；已用的留在库里当台账，不用摊给管理员看
  const free = invites.filter((i) => !i.used_by);
  const today = new Date().toISOString();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="l">
          <span className="mark" />
          <span className="docname">管理</span>
        </div>
        <div className="c" />
        <div className="r">
          <button className="btn ghost" onClick={() => void load()}>
            <Icon name="i-retry" className="ic sm" />
            刷新
          </button>
        </div>
      </header>
      <div className="studio">
        <div className="stage">
          {error && <div className="banner warn">{error}</div>}
          {ov && (
            <>
              <div className="stage-h">
                <h3>今天</h3>
                <span className="hint mono">
                  ¥{ov.costTodayYuan} / 预算 ¥{ov.budgetYuan} · worker {ov.worker.running}/{ov.worker.concurrency} · 审核{' '}
                  {ov.moderation}
                </span>
              </div>
              <div className="result-card">
                <div className="cand-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                  {Object.entries(ov.totals).map(([k, v]) => (
                    <div key={k}>
                      <div className="mono" style={{ fontSize: 20 }}>
                        {v}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="stage-h" style={{ marginTop: 18 }}>
                <h3>上游</h3>
              </div>
              <div className="result-card">
                {ov.providers.map((p) => (
                  <div className="kv" key={p.id} style={{ borderTop: 'none', paddingTop: 4 }}>
                    <span style={{ color: p.available ? 'var(--green)' : 'var(--ink-3)' }}>●</span>
                    <span>{p.label}</span>
                    <span className="v">{p.available ? p.capabilities.join(' ') : '未配置 API Key'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="params">
          <div className="field">
            <label>邀请码</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn primary" onClick={() => void mint()}>
                生成 3 个
              </button>
              <select
                className="input mono"
                style={{ width: 96, padding: '4px 6px', fontSize: 11 }}
                value={validDays}
                onChange={(e) => setValidDays(Number(e.target.value))}
                aria-label="有效期"
              >
                <option value={7}>7 天</option>
                <option value={30}>30 天</option>
                <option value={90}>90 天</option>
                <option value={0}>不限期</option>
              </select>
            </div>
            {codes.map((c) => (
              <input key={c} className="input mono" readOnly value={c} onFocus={(e) => e.currentTarget.select()} />
            ))}
            {free.length > 0 && (
              <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
                {free.slice(0, 8).map((i) => {
                  const dead = i.expires_at !== null && i.expires_at < today;
                  return (
                    <div key={i.code} className="mono" style={{ fontSize: 11, color: dead ? 'var(--red)' : 'var(--ink-3)' }}>
                      {i.code} · {dead ? '已过期' : `至 ${day(i.expires_at)}`}
                    </div>
                  );
                })}
                {free.length > 8 && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>…共 {free.length} 个未用</div>}
              </div>
            )}
          </div>
          <div className="field">
            <label>用户与配额</label>
            {users.map((u) => (
              <div key={u.id} className="banner" style={{ justifyContent: 'space-between' }}>
                <span>
                  {u.username}
                  {u.role === 'admin' && (
                    <span className="mono" style={{ color: 'var(--red)', marginLeft: 6 }}>
                      admin
                    </span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {u.quota.used}/{u.quotaPerDay} · ¥{u.quota.costTodayYuan}
                </span>
                <input
                  className="input mono"
                  style={{ width: 64, padding: '4px 6px', fontSize: 11 }}
                  defaultValue={u.quotaPerDay}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const v = Number(raw);
                    // 清空或填坏都当作没改：以前这里会把配额静默写成 0
                    if (raw === '' || !Number.isInteger(v) || v < 0 || v > 5000) {
                      e.target.value = String(u.quotaPerDay);
                      return;
                    }
                    void api
                      .patch(`/api/admin/users/${u.id}`, { quotaPerDay: v })
                      .then(() => load())
                      .catch(() => {
                        e.target.value = String(u.quotaPerDay);
                      });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
