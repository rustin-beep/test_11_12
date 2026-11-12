/** 通用 UI 工具:转义 / Toast / Modal / 确认框(原生 DOM,无框架) */

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

let toastBox: HTMLElement | null = null;
export function toast(msg: string, type: 'ok' | 'err' | 'info' = 'info', ms = 3000) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toast-box';
    document.body.appendChild(toastBox);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function modal(title: string, bodyHtml: string): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span>${esc(title)}</span><button class="modal-x" title="关闭">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  overlay.querySelector('.modal-x')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

export function confirmDlg(msg: string): Promise<boolean> {
  return new Promise(resolve => {
    const ov = modal('确认', `<p style="margin:4px 0 16px">${esc(msg)}</p>
      <div class="row-end"><button class="btn" id="dlg-no">取消</button><button class="btn danger" id="dlg-yes">确定</button></div>`);
    ov.querySelector('#dlg-no')!.addEventListener('click', () => { ov.remove(); resolve(false); });
    ov.querySelector('#dlg-yes')!.addEventListener('click', () => { ov.remove(); resolve(true); });
  });
}

/** 简单鉴权提示条 */
export function banner(msg: string, cls = 'warn'): HTMLElement {
  const b = document.createElement('div');
  b.className = `banner ${cls}`;
  b.textContent = msg;
  return b;
}
