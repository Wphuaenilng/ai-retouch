import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { MeDTO } from '@retouch/shared';
import { api } from './lib/api';
import { SseBridge } from './lib/sse';
import { LoginPage } from './features/auth/Login';
import { StudioPage } from './features/studio/Studio';
import { EditorPage } from './features/editor/Editor';
import { AdminPage } from './features/admin/Admin';

export function App(): ReactElement {
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');

  useEffect(() => {
    const check = (): void => {
      api
        .get<{ me: MeDTO }>('/api/me')
        .then(() => setState('in'))
        .catch(() => setState('out'));
    };
    check();
    const onAuthed = (): void => check();
    const off = (): void => setState('out');
    window.addEventListener('retouch:authed', onAuthed);
    window.addEventListener('retouch:unauthorized', off);
    return () => {
      window.removeEventListener('retouch:authed', onAuthed);
      window.removeEventListener('retouch:unauthorized', off);
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="login">
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <span className="mark" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 10 }} />
          正在进入暗房…
        </div>
      </div>
    );
  }

  if (state === 'out') {
    return (
      <>
        <SseBridge enabled={false} />
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      <SseBridge enabled />
      <Routes>
        <Route path="/" element={<Navigate to="/studio" replace />} />
        <Route path="/login" element={<Navigate to="/studio" replace />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/studio" replace />} />
      </Routes>
    </>
  );
}
