/** 深/浅主题:跟随系统 + 手动切换(localStorage 持久化) */

export type Theme = 'light' | 'dark';

function readPref(): Theme {
  const saved = localStorage.getItem('hw_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function initTheme() {
  document.documentElement.dataset.theme = readPref();
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('hw_theme', next);
  return next;
}

/** 主题切换按钮(顶栏/登录页复用),文案随当前主题变化;切换后广播 themechange 事件 */
export function themeToggleBtn(id: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'btn ghost sm';
  const sync = () => { btn.textContent = currentTheme() === 'dark' ? '☀️ 浅色' : '🌙 深色'; };
  btn.addEventListener('click', () => {
    toggleTheme();
    sync();
    document.dispatchEvent(new CustomEvent('themechange'));
  });
  sync();
  return btn;
}
