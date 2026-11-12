/** fetch 封装:自动带 token、同步服务器时钟、401 跳登录
 *  演示模式(npm run build:demo / dev --mode demo):无后端,路由到浏览器内 mock */
import { store } from './store.ts';
import { syncClock } from './clock.ts';
import type { MockError } from './mock/server.ts';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || '';
export const IS_DEMO: boolean = import.meta.env.MODE === 'demo';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

let mockPromise: Promise<typeof import('./mock/server.ts')> | null = null;
async function getMock() {
  mockPromise ??= import('./mock/server.ts');
  return await mockPromise;
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (IS_DEMO) {
    const { mockRequest, MockError: ME } = await getMock();
    syncClock(Date.now()); // 演示版:浏览器时钟即服务器时钟
    try {
      return await mockRequest<T>(path, { method: init?.method, body: init?.body, token: store.token });
    } catch (e) {
      const status = e instanceof ME ? (e as MockError).status : 500;
      if (status === 401 && store.token) { store.logout(); location.hash = '#/login'; }
      throw new ApiError(status, (e as Error).message);
    }
  }

  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (store.token) headers['Authorization'] = 'Bearer ' + store.token;
  const res = await fetch(API_BASE + path, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const st = res.headers.get('X-Server-Time');
  if (st) syncClock(Number(st));
  if (!res.ok) {
    if (res.status === 401 && store.token) {
      store.logout();
      location.hash = '#/login';
    }
    let msg = `请求失败 (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* 非 JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() as T : (res as unknown as T);
}

/** 下载文件类响应(CSV 导出等) */
export async function apiDownload(path: string, filename: string) {
  const blob = IS_DEMO ? await demoBlob(path) : await fetchBlob(path);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** 带鉴权获取文件内容(教师在线预览学生提交) */
export async function apiBlob(path: string): Promise<Blob> {
  return IS_DEMO ? demoBlob(path) : fetchBlob(path);
}

async function fetchBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (store.token) headers['Authorization'] = 'Bearer ' + store.token;
  const res = await fetch(API_BASE + path, { headers });
  if (!res.ok) throw new Error('文件加载失败');
  return res.blob();
}

/** 可在线预览的文本/图片扩展名(与服务端 TEXT_EXT 保持一致) */
export const PREVIEW_TEXT_EXT = new Set(['.txt', '.md', '.c', '.h', '.cpp', '.hpp', '.java', '.py', '.js', '.ts', '.html', '.css', '.json', '.xml', '.sql', '.sh', '.bat', '.csv']);
export const PREVIEW_IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

// ---- 演示模式:文件与 CSV 来自 mock(返回体带 __file / __csv 标记) ----
async function demoBlob(path: string): Promise<Blob> {
  const { mockRequest } = await getMock();
  const out = await mockRequest<any>(path, { token: store.token });
  if (out?.__file) return new Blob([out.__file]);
  if (out?.__csv) return new Blob([out.__csv], { type: 'text/csv' });
  throw new Error('文件加载失败');
}
