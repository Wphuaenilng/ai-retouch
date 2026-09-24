import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 同源开发，省掉 CORS 与 CSRF 的两套配置
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    // 生产不随产物发 .map：以前 3.7MB 的 TS 源码落在 /assets/*.map，
    // 而 app.ts 对 assets 给的是 max-age=31536000, immutable —— 一旦发出去就撤不回来
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});
