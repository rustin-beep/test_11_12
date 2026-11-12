/** 顶栏:导航 + 用户信息 + 改密/退出 */
import { store } from '../store.ts';
import { api } from '../api.ts';
import { esc, modal, toast } from '../ui.ts';
import { themeToggleBtn } from '../theme.ts';

export function topbar(root: HTMLElement, active: 'assignments' | 'roster' | '' = ''): void {
  const user = store.user!;
  const el = document.createElement('header');
  el.className = 'topbar';
  const isTeacher = user.role === 'teacher';
  el.innerHTML = `
    <div class="topbar-inner">
      <div class="brand">
        <span class="brand-dot"></span>作业管理系统
        ${isTeacher ? `
          <nav class="nav">
            <a href="#/teacher" class="${active === 'assignments' ? 'on' : ''}">作业管理</a>
            <a href="#/teacher/roster" class="${active === 'roster' ? 'on' : ''}">班级名单</a>
          </nav>` : `
          <nav class="nav"><a href="#/student" class="${active === 'assignments' ? 'on' : ''}">我的作业</a></nav>`}
      </div>
      <div class="topbar-right">
        <span class="role-tag ${isTeacher ? 't' : 's'}">${isTeacher ? '教师' : '学生'}</span>
        <span class="hi">${esc(user.name)}(${esc(user.studentNo ?? user.login)})</span>
        <button class="btn ghost sm" id="tb-pw">改密</button>
        <button class="btn ghost sm" id="tb-out">退出</button>
      </div>
    </div>`;
  el.querySelector('#tb-out')!.addEventListener('click', () => {
    store.logout();
    location.hash = '#/login';
  });
  // 主题切换(深/浅)
  el.querySelector('.topbar-right')!.prepend(themeToggleBtn('tb-theme'));
  el.querySelector('#tb-pw')!.addEventListener('click', () => {
    const ov = modal('修改密码', `
      <label>原密码<input type="password" id="pw-old" autocomplete="current-password"></label>
      <label>新密码(至少4位)<input type="password" id="pw-new"></label>
      <label>确认新密码<input type="password" id="pw-new2"></label>
      <div class="row-end"><button class="btn" id="pw-cancel">取消</button><button class="btn primary" id="pw-ok">保存</button></div>`);
    ov.querySelector('#pw-cancel')!.addEventListener('click', () => ov.remove());
    ov.querySelector('#pw-ok')!.addEventListener('click', async () => {
      const o = (ov.querySelector('#pw-old') as HTMLInputElement).value;
      const n1 = (ov.querySelector('#pw-new') as HTMLInputElement).value;
      const n2 = (ov.querySelector('#pw-new2') as HTMLInputElement).value;
      if (n1 !== n2) { toast('两次新密码不一致', 'err'); return; }
      try {
        await api('/api/change-password', { method: 'POST', body: { oldPassword: o, newPassword: n1 } });
        toast('密码已修改', 'ok');
        ov.remove();
      } catch (e) { toast((e as Error).message, 'err'); }
    });
  });
  root.appendChild(el);
}
