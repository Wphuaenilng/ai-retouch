import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeDTO } from '@retouch/shared';
import { api, errorText } from '../../lib/api';
import { Icon } from '../../ui/Icon';

export function LoginPage(): ReactElement {
  const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post<{ me: MeDTO }>(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        mode === 'login' ? { username, password } : { inviteCode: invite, username, password },
      );
      // 让 App 的鉴权门重新校验会话，否则它会继续把 * 渲染成登录页
      window.dispatchEvent(new Event('retouch:authed'));
      void nav('/studio', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>
          <span className="mark" />
          修图台
        </h1>
        <p className="sub">
          自然语言驱动的专业修图工作台。
          <br />
          邀请制，需要邀请码才能注册。
        </p>

        <div className="seg">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            登录
          </button>
          <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>
            邀请码注册
          </button>
        </div>

        {mode === 'register' && (
          <div className="field">
            <label>邀请码</label>
            <input
              className="input"
              value={invite}
              onChange={(e) => setInvite(e.target.value.toUpperCase())}
              placeholder="找管理员要一个"
              autoComplete="off"
            />
          </div>
        )}
        <div className="field">
          <label>用户名</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <span className="hint">至少 8 位</span>}
        </div>

        {error && (
          <div className="banner warn">
            <Icon name="i-x" className="ic sm" />
            {error}
          </div>
        )}

        <button className="btn primary lg" type="submit" disabled={busy || !username || !password}>
          {busy ? '请稍候…' : mode === 'login' ? '进入工作台' : '注册并进入'}
        </button>
      </form>
    </div>
  );
}
