import { useEffect, useState } from 'react';
import { clamp } from './clamp';

/**
 * 记住某一栏的宽度，刷新后仍在。
 * 单独成文件是因为 react-refresh：组件文件混着导出非组件会让整个模块退出热更新，
 * Splitter.tsx 里放这个 hook 就等于让拖宽栏的改动每次都要整页刷新。
 */
export function useColWidth(key: string, fallback: number, min: number, max: number): [number, (n: number) => void, () => void] {
  const [w, setW] = useState<number>(() => {
    const raw = Number(localStorage.getItem(key));
    return raw >= min && raw <= max ? raw : fallback;
  });
  useEffect(() => {
    localStorage.setItem(key, String(Math.round(w)));
  }, [key, w]);
  return [w, (n) => setW(clamp(n, min, max)), () => setW(fallback)];
}
