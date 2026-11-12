/** 登录页:学生/教师同一入口,按账号角色分流 */
import { api, IS_DEMO } from '../api.ts';
import { store } from '../store.ts';
import { ensureNotifyPermission } from '../notify.ts';
import { themeToggleBtn } from '../theme.ts';
import type { User } from '../../../shared/types.ts';

export function renderLogin(root: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.className = 'login-wrap';
  wrap.innerHTML = `
    <div class="login-card">
      <h1>作业管理系统</h1>
      <div class="sub">学生提交作业 · 教师发布与统计</div>
      ${IS_DEMO ? '<div class="demo-tag">静态演示版 · 数据仅存于本浏览器(多标签页共享)</div>' : ''}
      <label>登录名(学号 / 教师账号)<input id="li-user" autocomplete="username" placeholder="学号或 teacher"></label>
      <label>密码<input id="li-pw" type="password" autocomplete="current-password" placeholder="密码"></label>
      <button class="btn primary" id="li-go">登 录</button>
      <div class="login-help">
        <div class="help-block teacher">
          <div class="help-title">🧑‍🏫 教师账号</div>
          <p>账号 <code>teacher</code> · 初始密码 <code>123456</code></p>
          <p class="muted">首次部署时自动创建,登录后请立即修改密码。</p>
        </div>
        <div class="help-block student">
          <div class="help-title">🎓 学生账号</div>
          <p>账号为<b>你的学号</b> · 初始密码<b>同学号</b></p>
          <p class="muted">例:学号 <code>2025001</code> → 账号 <code>2025001</code>、密码 <code>2025001</code>。账号由任课教师导入班级名单后开通;登录后请尽快修改密码;忘记密码请联系教师重置(重置后恢复为学号)。</p>
        </div>
      </div>
      <div class="login-credit">
        <div class="credit-cats">
          <img src="https://rustin-beep.github.io/cat-light.svg" alt="会呼吸的像素猫" class="credit-cat">
          <a href="https://github.com/rustin-beep" target="_blank" rel="noopener" title="GitHub 主页">
            <img src="https://github.com/rustin-beep.png?size=96" alt="迪克组 GitHub 头像" class="credit-avatar">
          </a>
          <span id="li-theme-slot"></span>
        </div>
        <div>本课程作业系统 · 提交人:<b>迪克组</b></div>
        <div>博客:<a href="https://rustin-beep.github.io" target="_blank" rel="noopener">rustin-beep.github.io</a></div>
      </div>
    </div>`;
  root.appendChild(wrap);
  // 深/浅主题切换:放在头像旁边
  wrap.querySelector('#li-theme-slot')!.appendChild(themeToggleBtn('li-theme'));
  // 猫按主题换深浅版本(浅色线条猫在深色背景会看不见)
  const catImg = wrap.querySelector('.credit-cat') as HTMLImageElement;
  const syncCat = () => { catImg.src = document.documentElement.dataset.theme === 'dark'
    ? 'https://rustin-beep.github.io/cat-dark.svg' : 'https://rustin-beep.github.io/cat-light.svg'; };
  syncCat();
  document.addEventListener('themechange', syncCat);

  const userInput = wrap.querySelector('#li-user') as HTMLInputElement;
  const pwInput = wrap.querySelector('#li-pw') as HTMLInputElement;
  const go = async () => {
    try {
      const r = await api<{ token: string; user: User }>('/api/login', {
        method: 'POST',
        body: { login: userInput.value.trim(), password: pwInput.value },
      });
      store.save(r.token, r.user);
      if (r.user.role === 'student') ensureNotifyPermission();
      location.hash = r.user.role === 'teacher' ? '#/teacher' : '#/student';
    } catch (e) {
      alert((e as Error).message);
    }
  };
  wrap.querySelector('#li-go')!.addEventListener('click', go);
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  userInput.focus();

  // 外链图加载失败时退化为 emoji(离线环境不至于裂图)
  wrap.querySelectorAll<HTMLImageElement>('.credit-cat').forEach(img => {
    img.addEventListener('error', () => { img.outerHTML = '<span class="credit-cat-emoji">🐱</span>'; });
  });
  wrap.querySelectorAll<HTMLImageElement>('.credit-avatar').forEach(img => {
    img.addEventListener('error', () => { img.outerHTML = '<span class="credit-cat-emoji">👤</span>'; });
  });
}
