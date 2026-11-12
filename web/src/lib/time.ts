/** 倒计时/时间相关纯函数(无 DOM,便于 node:test 单测) */

export const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** 剩余毫秒 → "2天 03:24:11" / "03:24:11" / "已逾期" */
export function fmtRemain(ms: number): string {
  if (ms <= 0) return '已逾期';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return d > 0 ? `${d}天 ${hms}` : hms;
}

export type Level = 'safe' | 'warn' | 'danger' | 'over';

/** 分级:>1h 绿 / ≤1h 橙 / ≤10min 红(前端提醒阈值)/ ≤0 逾期 */
export function levelOf(remainMs: number, warnMs = 3600_000, dangerMs = 600_000): Level {
  if (remainMs <= 0) return 'over';
  if (remainMs <= dangerMs) return 'danger';
  if (remainMs <= warnMs) return 'warn';
  return 'safe';
}

/** 时间戳 → 可读时间 */
export function fmtDT(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 时间戳 → datetime-local 输入框值(本机时区) */
export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 值 → 时间戳 */
export function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
