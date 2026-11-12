/** 倒计时组件:每秒 tick,基于服务器校准时钟,四级状态样式 */
import { now } from '../clock.ts';
import { fmtRemain, levelOf } from '../lib/time.ts';
import { addPageTimer } from '../lib/timers.ts';

export function mountCountdown(el: HTMLElement, getDeadline: () => number, large = false): () => void {
  const tick = () => {
    const remain = getDeadline() - now();
    const lv = levelOf(remain);
    el.textContent = lv === 'over' ? '已逾期' : fmtRemain(remain);
    el.className = `countdown ${lv}${large ? ' large' : ''}`;
  };
  tick();
  const t = setInterval(tick, 1000);
  addPageTimer(t);
  return () => clearInterval(t);
}
