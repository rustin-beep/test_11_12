/**
 * 学生端 · 作业列表
 * - 卡片 + 实时倒计时(服务器时钟基准)
 * - 30s 轮询:version 变化 → 提示并刷新(教师延长截止时作业"复活")
 * - 临近截止(≤10min)且未提交:横幅 + 系统通知 + 提示音(每个作业一次)
 */
import { api } from '../api.ts';
import { topbar } from '../components/topbar.ts';
import { mountCountdown } from '../components/countdown.ts';
import { esc, toast, banner } from '../ui.ts';
import { now } from '../clock.ts';
import { levelOf, fmtDT } from '../lib/time.ts';
import { addPageTimer } from '../lib/timers.ts';
import { beep, sysNotify } from '../notify.ts';
import { submitWindow } from '../../../shared/types.ts';
import type { StudentAssignment, Assignment } from '../../../shared/types.ts';

/** 倒计时目标:过了主截止但仍在补交期 → 目标切到补交截止(显示"还可补交多久") */
function effectiveDeadline(a: Assignment): number {
  const n = now();
  return (a.allowLate && a.lateDeadline != null && n > a.deadline && n <= a.lateDeadline)
    ? a.lateDeadline : a.deadline;
}

export async function renderStudentList(root: HTMLElement) {
  topbar(root);
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  let known = new Map<number, number>(); // id → version
  const renderList = (list: StudentAssignment[], notify = false) => {
    // 教师修改了作业信息(version 变化)→ 提示
    if (notify) {
      for (const a of list) {
        const old = known.get(a.id);
        if (old !== undefined && old !== a.version)
          toast(`作业《${a.title}》信息已更新(如截止时间调整)`, 'info');
      }
    }
    known = new Map(list.map(a => [a.id, a.version]));

    page.innerHTML = `
      <div class="page-head"><h2 class="page-title">我的作业</h2><span class="muted">共 ${list.length} 项</span></div>`;
    const holder = document.createElement('div');
    page.appendChild(holder);

    const nowMs = now();
    const expiredMissing = list.filter(a => submitWindow(a, nowMs) === 'closed' && !a.my);
    if (expiredMissing.length)
      holder.appendChild(banner(`你有 ${expiredMissing.length} 项作业已逾期未交:${expiredMissing.map(a => `《${esc(a.title)}》`).join(' ')}`, 'danger'));

    const upcoming = list.filter(a => !a.my && levelOf(a.deadline - nowMs) === 'danger');
    if (upcoming.length) {
      holder.appendChild(banner(`⚠ ${upcoming.length} 项作业即将截止:${upcoming.map(a => `《${esc(a.title)}》`).join(' ')} 抓紧提交!`, 'warn'));
      for (const a of upcoming) {
        const key = `hw_notified_${a.id}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          sysNotify('作业即将截止', `《${a.title}》即将截止,请尽快提交!`);
          beep();
        }
      }
    }

    if (!list.length) {
      holder.innerHTML = '<div class="card muted">暂无作业</div>';
      return;
    }
    for (const a of list) {
      const card = document.createElement('div');
      card.className = 'card hw-card';
      const st = submitWindow(a, nowMs);
      const badge = !a.my
        ? (st === 'closed' ? '<span class="badge red">已逾期</span>' : '<span class="badge blue">未提交</span>')
        : (a.my.isLate ? '<span class="badge orange">逾期已交</span>' : '<span class="badge green">已提交</span>');
      const scored = a.my?.score != null
        ? `<span class="badge gray">成绩:${a.my.score}${a.my.comment ? ' · ' + esc(a.my.comment) : ''}</span>` : '';
      card.innerHTML = `
        <div class="hw-main">
          <div class="hw-title"><span class="badge gray">${esc(a.className)}</span>${esc(a.title)} ${badge} ${scored}</div>
          <div class="hw-desc">${esc(a.description || '(无说明)')}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">截止:${fmtDT(a.deadline)}${a.allowLate ? ` · 可补交至 ${fmtDT(a.lateDeadline)}` : ''}${a.my ? ` · 已交 ${a.my.attemptCount} 次` : ''}</div>
        </div>
        <div class="hw-side"><span class="cd" data-cd="${a.id}"></span></div>`;
      card.addEventListener('click', () => { location.hash = `#/student/a/${a.id}`; });
      holder.appendChild(card);
      mountCountdown(card.querySelector(`[data-cd="${a.id}"]`) as HTMLElement, () => effectiveDeadline(a));
    }
  };

  // 30s 轮询:数据指纹(JSON)变化才重绘,避免无谓的整页重建
  let lastFp = '';
  const fetchList = async () => {
    try {
      const list = await api<StudentAssignment[]>('/api/assignments');
      const fp = JSON.stringify(list);
      if (fp === lastFp) return;
      const notify = lastFp !== ''; // 非首次变化 → 提示 version 更新
      lastFp = fp;
      renderList(list, notify);
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  await fetchList();
  addPageTimer(setInterval(fetchList, 30_000));
}
