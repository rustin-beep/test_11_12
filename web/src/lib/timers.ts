/** 页面级定时器登记:路由切换时统一清理,防止泄漏 */
const timers = new Set<ReturnType<typeof setInterval>>();

export function addPageTimer(t: ReturnType<typeof setInterval>) {
  timers.add(t);
}

export function stopPageTimers() {
  for (const t of timers) clearInterval(t);
  timers.clear();
}
