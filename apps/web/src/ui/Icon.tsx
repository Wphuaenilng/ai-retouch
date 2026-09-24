/** 图标与设计稿 §06 的 1.5px 线性图标一一对应 */
import type { ReactElement } from 'react';

const PATHS: Record<string, ReactElement> = {
  'i-adjust': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  'i-eraser': (
    <>
      <path d="M13.5 5.5l5 5-8.5 8.5H5.5L4 17.5z" />
      <path d="M10 9l5 5" />
    </>
  ),
  'i-cut': (
    <>
      <circle cx="6" cy="6.5" r="2.3" />
      <circle cx="6" cy="17.5" r="2.3" />
      <path d="M8 7.8L20 18M8 16.2L20 6" />
    </>
  ),
  'i-bg': (
    <>
      <rect x="3.5" y="5" width="12" height="9" rx="1.5" />
      <rect x="8.5" y="10" width="12" height="9" rx="1.5" />
    </>
  ),
  'i-expand': (
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      <path d="M12 8.5v7M9.5 11l2.5-2.5L14.5 11M9.5 13l2.5 2.5 2.5-2.5" />
    </>
  ),
  'i-upscale': (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M10.5 8v5M8 10.5h5M15 15l5 5" />
    </>
  ),
  'i-text': <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  'i-crop': <path d="M7 3v14h14M3 7h14v14" />,
  'i-layers': (
    <>
      <path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
    </>
  ),
  'i-heal': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 9v6M9 12h6" />
    </>
  ),
  'i-undo': (
    <>
      <path d="M8 8L4 12l4 4" />
      <path d="M4 12h10a5 5 0 0 1 5 5v1" />
    </>
  ),
  'i-redo': (
    <>
      <path d="M16 8l4 4-4 4" />
      <path d="M20 12H10a5 5 0 0 0-5 5v1" />
    </>
  ),
  'i-compare': (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M12 5v14" />
      <path d="M9.5 10.5L7.5 12l2 1.5M14.5 10.5l2 1.5-2 1.5" />
    </>
  ),
  'i-export': (
    <>
      <path d="M12 4v10M8.5 10.5L12 14l3.5-3.5" />
      <path d="M5 19h14" />
    </>
  ),
  'i-import': (
    <>
      <path d="M12 14V4M8.5 7.5L12 4l3.5 3.5" />
      <path d="M5 19h14" />
    </>
  ),
  'i-plus': <path d="M12 5.5v13M5.5 12h13" />,
  'i-eye': (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  'i-eyeoff': (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M4 4l16 16" />
    </>
  ),
  'i-check': <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'i-x': <path d="M6 6l12 12M18 6L6 18" />,
  'i-play': <path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" stroke="none" />,
  'i-clock': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  'i-retry': (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5V8H16" />
    </>
  ),
  'i-send': (
    <>
      <path d="M4 11.5L20 4l-6.5 16-2.3-6.2z" />
      <path d="M11.2 13.8L20 4" />
    </>
  ),
  'i-user': (
    <>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  'i-left': <path d="M14.5 5L8 12l6.5 7" />,
  'i-brush': (
    <>
      <path d="M4 20c3 .5 4.5-1 4.5-3S7 14 5.5 14" />
      <path d="M9.5 14.5L19 5l1 1-9 10z" />
    </>
  ),
  'i-hand': (
    <>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 5 14.5l1.8 1.2" />
    </>
  ),
};

export function Icon({ name, className = 'ic' }: { name: string; className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name] ?? PATHS['i-heal']}
    </svg>
  );
}
