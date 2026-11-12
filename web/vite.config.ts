import { defineConfig } from 'vite';

// 开发模式:vite (5173) 代理 /api → 后端 (8080),同源免 CORS
// 前后端分离部署:构建时设 VITE_API_BASE=https://你的后端域名
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { target: 'es2022' },
});
