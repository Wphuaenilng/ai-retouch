import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { api, errorText } from '../../lib/api';
import { runClientTool } from '../../lib/clientTools';
import { useEvent } from '../../lib/sse';
import type { PlanDTO, PlanStepDTO } from '@retouch/shared';
import { Icon } from '../../ui/Icon';

type Msg = { role: 'user' | 'agent' | 'error'; text: string };

function StepIcon({ status }: { status: PlanStepDTO['status'] }): ReactElement {
  const map = {
    succeeded: 'done',
    running: 'run',
    failed: 'fail',
    skipped: 'skip',
    canceled: 'skip',
    pending: '',
  } as const;
  const icon = { succeeded: 'i-check', running: 'i-play', failed: 'i-x', skipped: 'i-x', canceled: 'i-x', pending: 'i-clock' }[status];
  return <span className={`st ${map[status]}`}>{<Icon name={icon} className="ic sm" />}</span>;
}

function PlanCard({
  plan,
  onAction,
  busy,
}: {
  plan: PlanDTO;
  onAction: (kind: 'approve' | 'cancel' | 'retry' | 'skip', idx?: number) => void;
  busy: boolean;
}): ReactElement {
  const cost = plan.steps.reduce((a, s) => a + (s.costYuan ?? 0), 0);
  return (
    <div className="plan">
      {plan.steps.map((s) => (
        <div className="step" key={s.idx}>
          <StepIcon status={s.status} />
          <div className="step-main">
            <div className="step-name">
              {s.title}
              {s.executor === 'client' && <span className="t"> · 本地</span>}
            </div>
            <div className="step-meta">
              {s.status === 'succeeded' && `完成${s.durationMs ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : ''}${s.costYuan ? ` · ¥${s.costYuan.toFixed(2)}` : ''}`}
              {s.status === 'running' && '执行中…'}
              {s.status === 'pending' && '等待前序'}
              {s.status === 'failed' && (s.error ?? '失败')}
              {s.status === 'skipped' && '已跳过'}
              {s.status === 'canceled' && '已取消'}
            </div>
            {s.status === 'failed' && (
              <div className="step-acts">
                <button className="btn" onClick={() => onAction('retry', s.idx)}>
                  <Icon name="i-retry" className="ic sm" />
                  重试本步
                </button>
                <button className="btn ghost" onClick={() => onAction('skip', s.idx)}>
                  跳过并继续
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {plan.status === 'failed' && <div className="err-line">本步未计费 · 已完成的步骤保留在画布上</div>}
      <div className="plan-foot">
        <span>计划 ¥{cost.toFixed(2)}</span>
        <span className="sp" />
        {plan.status === 'proposed' && (
          <button className="btn primary" style={{ height: 26, fontSize: 11 }} disabled={busy} onClick={() => onAction('approve')}>
            确认执行
          </button>
        )}
        {(plan.status === 'proposed' || plan.status === 'running') && (
          <button className="btn ghost" style={{ height: 26, fontSize: 11 }} onClick={() => onAction('cancel')}>
            取消
          </button>
        )}
        {plan.status === 'done' && <span style={{ color: 'var(--green)' }}>全部完成</span>}
      </div>
    </div>
  );
}

export function AgentPanel({ documentId }: { documentId: string }): ReactElement {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** SSE 是按用户广播的：本面板只认属于当前文档的计划和只执行一次的指令 */
  const seenCommands = useRef(new Set<string>());

  const upsert = useCallback(
    (p: PlanDTO) => {
      if (p.documentId !== documentId) return;
      setPlans((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]));
    },
    [documentId],
  );

  useEvent('plan.created', (e) => upsert(e.plan));
  useEvent('plan.updated', (e) => upsert(e.plan));

  // Agent 下发的本地步骤：执行后回执，服务端才继续往下走
  useEvent('agent.client_command', async (e) => {
    if (seenCommands.current.has(e.requestId)) return;
    seenCommands.current.add(e.requestId);
    try {
      await runClientTool(e.tool, e.params);
      await api.post('/api/agent/receipt', { requestId: e.requestId, ok: true });
    } catch (err) {
      await api.post('/api/agent/receipt', { requestId: e.requestId, ok: false, error: errorText(err) }).catch(() => undefined);
    }
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, plans]);

  const ask = async (): Promise<void> => {
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    try {
      const { plan } = await api.post<{ plan: PlanDTO }>('/api/agent/plans', { documentId, message });
      upsert(plan);
      setMsgs((m) => [...m, { role: 'agent', text: `拆成 ${plan.steps.length} 步，确认后开始。` }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: errorText(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const act = async (planId: string, kind: 'approve' | 'cancel' | 'retry' | 'skip', idx?: number): Promise<void> => {
    try {
      const path =
        kind === 'approve'
          ? `/api/agent/plans/${planId}/approve`
          : kind === 'cancel'
            ? `/api/agent/plans/${planId}/cancel`
            : `/api/agent/plans/${planId}/steps/${idx}/${kind}`;
      const { plan } = await api.post<{ plan: PlanDTO }>(path);
      upsert(plan);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: errorText(e) }]);
    }
  };

  return (
    <div className="chat">
      <div className="panel-h">
        对 话
        <span className="tag mono">{busy ? '规划中…' : '说人话即可'}</span>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {msgs.length === 0 && (
          <div className="msg-a">
            例：把背景换成米白摄影棚，裁成 1:1，再亮一点。
            <br />
            需要局部处理时先在画布上涂抹选区，再说"去掉我圈起来的东西"。
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div className="msg-u" key={i}>
              {m.text}
            </div>
          ) : (
            <div className="msg-a" key={i} style={m.role === 'error' ? { color: '#d06a56' } : undefined}>
              {m.text}
            </div>
          ),
        )}
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} busy={busy} onAction={(kind, idx) => void act(p.id, kind, idx)} />
        ))}
      </div>
      <div className="chat-in">
        <textarea
          value={input}
          placeholder="继续描述想怎么改…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <button className="btn primary" onClick={() => void ask()} disabled={busy || !input.trim()} aria-label="发送">
          <Icon name="i-send" className="ic sm" />
        </button>
      </div>
    </div>
  );
}
