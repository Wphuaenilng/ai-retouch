import { useMemo, useState, type ReactElement } from 'react';
import type { FieldSpec, ToolDef } from '@retouch/shared';
import { Icon } from '../../ui/Icon';

export interface ToolSubmit {
  tool: ToolDef;
  params: Record<string, unknown>;
}

function defaults(tool: ToolDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of tool.fields) {
    if (f.kind === 'toggle') out[f.key] = false;
    else if (f.kind === 'slider') out[f.key] = 0;
    else if (f.kind === 'select' && f.options?.length) out[f.key] = f.options[0]!.value;
    else if (f.kind === 'color') out[f.key] = '';
    else out[f.key] = '';
  }
  return out;
}

/** 表单完全由注册表的 fields 生成 —— 加工具不用改前端 */
export function ToolForm({
  tool,
  hasImage,
  hasSelection,
  busy,
  onSubmit,
  compact,
}: {
  tool: ToolDef;
  hasImage: boolean;
  hasSelection: boolean;
  busy?: boolean;
  onSubmit: (s: ToolSubmit) => void;
  compact?: boolean;
}): ReactElement {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaults(tool));
  const [touched, setTouched] = useState(false);

  const missing = useMemo(() => {
    const list: string[] = [];
    if (tool.needsImage && !hasImage) list.push('先上传或选择一张图');
    if (tool.needsMask && !hasSelection) list.push('先在画布上涂抹选区');
    const promptField = tool.fields.find((f) => f.key === 'prompt');
    if (promptField && tool.name === 'prompt_edit' && !String(values.prompt ?? '').trim()) list.push('写下要怎么改');
    if (tool.name === 'replace_background' && !String(values.prompt ?? '').trim() && !String(values.color ?? '').trim())
      list.push('描述新背景或选一个纯色');
    if (tool.name === 'text2image' && !String(values.prompt ?? '').trim()) list.push('写下想画什么');
    return list;
  }, [tool, hasImage, hasSelection, values]);

  const set = (k: string, v: unknown): void => setValues((s) => ({ ...s, [k]: v }));

  const submit = (): void => {
    setTouched(true);
    if (missing.length || busy) return;
    const params: Record<string, unknown> = {};
    for (const f of tool.fields) {
      const v = values[f.key];
      if (v === '' || v === undefined || v === null) continue;
      if (f.kind === 'slider' && Number(v) === 0 && !compact) continue;
      params[f.key] = v;
    }
    onSubmit({ tool, params });
  };

  const renderField = (f: FieldSpec): ReactElement | null => {
    const v = values[f.key];
    if (f.kind === 'imageRef') {
      return (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <div className="hint">
            {f.needsSelection
              ? hasSelection
                ? '已使用当前选区'
                : (f.hint ?? '需要先有选区')
              : hasImage
                ? '使用当前图片'
                : (f.hint ?? '需要先有一张图')}
          </div>
        </div>
      );
    }
    if (f.kind === 'textarea') {
      return (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <textarea
            className="textarea"
            placeholder={f.placeholder}
            value={String(v ?? '')}
            onChange={(e) => set(f.key, e.target.value)}
            rows={compact ? 2 : 3}
          />
          {f.hint && <div className="hint">{f.hint}</div>}
        </div>
      );
    }
    if (f.kind === 'select') {
      return (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <div className="seg">
            {(f.options ?? []).map((o) => (
              <button
                key={String(o.value)}
                type="button"
                className={String(v) === String(o.value) ? 'on' : ''}
                onClick={() => set(f.key, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (f.kind === 'slider') {
      return (
        <div className="field" key={f.key}>
          <label>
            {f.label}
            <span className="v">{Number(v ?? 0).toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={f.min ?? -1}
            max={f.max ?? 1}
            step={f.step ?? 0.01}
            value={Number(v ?? 0)}
            onChange={(e) => set(f.key, Number(e.target.value))}
          />
        </div>
      );
    }
    if (f.kind === 'number') {
      return (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <input
            className="input"
            type="number"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={Number(v ?? 0)}
            onChange={(e) => set(f.key, Number(e.target.value))}
          />
        </div>
      );
    }
    if (f.kind === 'color') {
      return (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              style={{ width: 44, flex: 'none' }}
              value={/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '#ffffff'}
              onChange={(e) => set(f.key, e.target.value)}
            />
            <input
              className="input"
              placeholder="#ffffff 留空则不启用"
              value={String(v ?? '')}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
          {f.hint && <div className="hint">{f.hint}</div>}
        </div>
      );
    }
    if (f.kind === 'toggle') {
      return (
        <div className={`field switch ${v ? 'on' : ''}`} key={f.key} onClick={() => set(f.key, !v)}>
          <span>{f.label}</span>
          <i />
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tool.fields.map(renderField)}
      {touched && missing.length > 0 && (
        <div className="banner warn">
          <Icon name="i-clock" className="ic sm" />
          <span>{missing.join('；')}</span>
        </div>
      )}
      <button className="btn primary lg" onClick={submit} disabled={busy || (touched && missing.length > 0)}>
        {busy ? '执行中…' : `${tool.title}${tool.costYuan > 0 ? ` · 约 ¥${tool.costYuan}` : ''}`}
      </button>
    </div>
  );
}
