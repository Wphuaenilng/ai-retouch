import { useState, type ReactElement } from 'react';
import { errorText } from '../../lib/api';
import { PRIVACY_LINES, PRIVACY_NOTE, acceptConsent } from '../../lib/privacy';

/**
 * 首次上传前的一次性确认。阻塞式：不点清楚就不会有任何字节离开浏览器。
 * 确认结果记在服务端账号上（不是 localStorage），所以换浏览器会再问一次。
 */
export function ConsentModal({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agree = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await acceptConsent();
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="上传前须知">
      <div className="modal">
        <h3>上传前须知</h3>
        <p className="sub">这一步只做一次，记在你的账号上。</p>
        <ol>
          {PRIVACY_LINES.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
        <p className="sub">{PRIVACY_NOTE}</p>
        {error && <div className="banner warn">{error}</div>}
        <div className="acts">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            先不传
          </button>
          <button className="btn primary" onClick={() => void agree()} disabled={busy}>
            {busy ? '记录中…' : '我知道了，继续上传'}
          </button>
        </div>
      </div>
    </div>
  );
}
