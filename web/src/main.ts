/** 入口:hash 路由(原生,无框架) */
import { store } from './store.ts';
import { initTheme } from './theme.ts';

initTheme();
import { stopPageTimers } from './lib/timers.ts';
import { renderLogin } from './pages/login.ts';
import { renderStudentList } from './pages/student-list.ts';
import { renderStudentDetail } from './pages/student-detail.ts';
import { renderTeacherAssignments } from './pages/teacher-assignments.ts';
import { renderTeacherRoster } from './pages/teacher-roster.ts';
import { renderTeacherStats } from './pages/teacher-stats.ts';
import { ensureNotifyPermission } from './notify.ts';

type PageFn = (root: HTMLElement, m: RegExpMatchArray) => void;

const routes: { re: RegExp; fn: PageFn; role?: 'teacher' | 'student' }[] = [
  { re: /^\/login$/, fn: root => renderLogin(root) },
  { re: /^\/student$/, fn: root => renderStudentList(root), role: 'student' },
  { re: /^\/student\/a\/(\d+)$/, fn: (r, m) => renderStudentDetail(r, m), role: 'student' },
  { re: /^\/teacher$/, fn: root => renderTeacherAssignments(root), role: 'teacher' },
  { re: /^\/teacher\/roster$/, fn: root => renderTeacherRoster(root), role: 'teacher' },
  { re: /^\/teacher\/stats\/(\d+)$/, fn: (r, m) => renderTeacherStats(r, m), role: 'teacher' },
];

// 网址入口:/student/**、/teacher/** 直达路径完整转为对应 hash
// (整个系统部署在同一网站下时,直接把这两个链接分发给学生和教师)
if (!location.hash) {
  const p = location.pathname;
  if (p === '/student' || p === '/teacher' || p.startsWith('/student/') || p.startsWith('/teacher/'))
    location.hash = '#' + p;
}

window.addEventListener('hashchange', render);
render();

function render() {
  stopPageTimers();
  const root = document.getElementById('app')!;
  root.innerHTML = '';
  const user = store.user;
  const path = (location.hash || '#/login').slice(1);

  if (!user) {
    if (path !== '/login') { location.hash = '#/login'; return; }
    renderLogin(root);
    return;
  }
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    if (r.role && r.role !== user.role) { location.hash = user.role === 'teacher' ? '#/teacher' : '#/student'; return; }
    r.fn(root, m);
    return;
  }
  location.hash = user.role === 'teacher' ? '#/teacher' : '#/student';
}

// 学生登录后请求系统通知权限(截止前弹窗提醒)
if (store.user?.role === 'student') ensureNotifyPermission();

// 全局输入脏标记:带 data-init 的输入被用户改动且未保存时标 data-dirty,
// 30s 轮询刷新据此让路,避免重渲染丢掉正在填写的内容(教师批阅分数/评语等)
document.addEventListener('input', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && 'init' in t.dataset) {
    t.dataset.dirty = String((t as HTMLInputElement).value !== t.dataset.init);
  }
});
