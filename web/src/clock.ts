/**
 * 服务器时钟校准:所有倒计时基于服务器时间,学生改本机时间不影响显示与判定。
 * 每次收到 API 响应(X-Server-Time 头)自动同步偏移。
 */
let offset = 0;

export function syncClock(serverNowMs: number) {
  offset = serverNowMs - Date.now();
}

/** 服务器视角的当前时间(毫秒) */
export function now(): number {
  return Date.now() + offset;
}
