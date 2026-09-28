import { useRef, type ReactElement } from 'react';
import { clamp } from '../lib/clamp';

/**
 * 竖向分隔条。invert=false 表示在右侧栏的左边（往拖窄）；invert=true 表示在左侧栏的右边（往拖宽）。
 * 双击复位到默认宽度。
 */
export function Splitter({
  value,
  min,
  max,
  invert,
  onChange,
  onReset,
}: {
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (n: number) => void;
  onReset: () => void;
}): ReactElement {
  const start = useRef({ x: 0, w: 0 });
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度 · 双击复位"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: value };
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        const d = (e.clientX - start.current.x) * (invert ? 1 : -1);
        onChange(clamp(start.current.w + d, min, max));
      }}
      onDoubleClick={onReset}
    >
      <i />
    </div>
  );
}
