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

export function AdminPage(): ReactElement {
  const [ov, setOv] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    try {
      const [a, b] = await Promise.all([api.get<Overview>('/api/admin/overview'), api.get<{ users: AdminUser[] }>('/api/admin/users')]);
      setOv(a);
      setUsers(b.users);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const mint = async (): Promise<void> => {
    const r = await api.post<{ codes: string[] }>('/api/admin/invites', { count: 3 });
    setCodes((c) => [...r.codes, ...c]);
    void load();
  };

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
                  ¥{ov.costTodayYuan} / 预算 ¥{ov.budgetYuan} · worker {ov.worker.running}/{ov.worker.concurrency} · 审核 {ov.moderation}
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
            <button className="btn primary" onClick={() => void mint()}>
              生成 3 个
            </button>
            {codes.map((c) => (
              <input key={c} className="input mono" readOnly value={c} onFocus={(e) => e.currentTarget.select()} />
            ))}
          </div>
          <div className="field">
            <label>用户与配额</label>
            {users.map((u) => (
              <div key={u.id} className="banner" style={{ justifyContent: 'space-between' }}>
                <span>
                  {u.username}
                  {u.role === 'admin' && <span className="mono" style={{ color: 'var(--red)', marginLeft: 6 }}>admin</span>}
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
