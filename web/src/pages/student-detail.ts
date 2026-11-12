/**
 * 学生端 · 作业详情 + 提交
 * - 大号倒计时(服务器时钟);教师改截止后 30s 轮询自动更新
 * - 提交:文件(≤8MB,base64)/ 文本;截止前可覆盖重交(次数+1,旧版本留档);逾期禁止,补交期内可交但标记"逾期提交"
 * - 轮询防丢输入:焦点在输入框/有未保存草稿/已选文件时不刷新;文本草稿存 sessionStorage
 */
import { api } from '../api.ts';
import { topbar } from '../components/topbar.ts';
import { mountCountdown } from '../components/countdown.ts';
import { esc, toast, banner } from '../ui.ts';
import { now } from '../clock.ts';
import { fmtDT, fmtSize } from '../lib/time.ts';
import { addPageTimer } from '../lib/timers.ts';
import { busyInput } from '../lib/dom.ts';
import { apiDownload } from '../api.ts';
import { submitWindow } from '../../../shared/types.ts';
import type { Assignment, MySubmission } from '../../../shared/types.ts';

const MAX_FILE = 8 * 1024 * 1024;

type Detail = Assignment & { my: MySubmission | null };

export async function renderStudentDetail(root: HTMLElement, m: RegExpMatchArray) {
  topbar(root);
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);
  const id = m[1];
  const draftKey = `hw_draft_a${id}`;

  // 倒计时目标与已选文件放在可变 state:轮询重渲染不丢失,教师延长截止后原位更新
  const state: { a: Detail | null; file: File | null } = { a: null, file: null };
  let lastFp = '';

  const applyDetail = (a: Detail, changed: boolean) => {
    state.a = a;
    if (changed) toast('本作业信息已被教师更新', 'info');

    const win = submitWindow(a, now());
    page.innerHTML = `
      <div class="page-head">
        <h2 class="page-title">《${esc(a.title)}》<span class="badge gray" style="vertical-align:middle">${esc(a.className)}</span></h2>
        <a href="#/student" class="btn ghost sm">← 返回列表</a>
      </div>
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div class="muted" style="font-size:13px">距提交截止还剩</div>
          <div class="cd-big"></div>
          <div class="muted" style="font-size:12px;margin-top:6px">截止:${fmtDT(a.deadline)}
            ${a.allowLate ? ` · 允许逾期补交至 ${fmtDT(a.lateDeadline)}` : ' · 逾期不可提交'}</div>
        </div>
        <div style="text-align:right">
          <div class="muted" style="font-size:12px">提交要求:${
            a.submitType === 'file' ? '上传文件' : a.submitType === 'text' ? '填写内容' : '文件或内容均可'}</div>
        </div>
      </div>
      <div class="msgs"></div>
      <div class="card form-area"><h3>提交作业</h3><div class="form-body"></div></div>
      <div class="my-area"></div>`;

    // 倒计时目标:过了主截止但仍在补交期 → 切到补交截止
    mountCountdown(page.querySelector('.cd-big') as HTMLElement, () => {
      const a = state.a!;
      const n = now();
      return (a.allowLate && a.lateDeadline != null && n > a.deadline && n <= a.lateDeadline)
        ? a.lateDeadline : a.deadline;
    }, true);

    const msgs = page.querySelector('.msgs') as HTMLElement;
    if (win === 'closed')
      msgs.appendChild(banner('该作业已超过截止时间(含补交),无法再提交。', 'danger'));
    else if (win === 'late')
      msgs.appendChild(banner(`已过截止时间,补交期内提交将标记为「逾期提交」,补交截止:${fmtDT(a.lateDeadline)}`, 'warn'));

    // ---- 提交表单 ----
    const needFile = a.submitType === 'file' || a.submitType === 'both';
    const needText = a.submitType === 'text' || a.submitType === 'both';
    // 文本草稿:上次未提交的输入优先于已提交内容(sessionStorage)
    const saved = a.my?.content ?? '';
    const draft = sessionStorage.getItem(draftKey);
    const textInit = draft != null ? draft : saved;

    (page.querySelector('.form-body') as HTMLElement).innerHTML = `
      ${needFile ? `<div class="dropzone" id="dz">点击选择文件,或将文件拖到这里<br><span style="font-size:12px">≤ 8MB</span><span class="fname"></span></div><input type="file" id="file-in" hidden>` : ''}
      ${needText ? `<label>作业内容(文本)${needFile ? '(可选,与文件至少一项)' : ''}<textarea id="txt-in" rows="6" placeholder="在此填写作业内容…">${esc(textInit)}</textarea></label>` : ''}
      <div class="row-end">
        ${a.my ? '<span class="muted" style="margin-right:auto;font-size:12px">你已提交过(可覆盖重交,已交 ' + a.my.attemptCount + ' 次),重新提交将清空已有批阅</span>' : ''}
        <button class="btn primary" id="submit-btn" ${win === 'closed' ? 'disabled' : ''}>
          ${win === 'closed' ? '已逾期,不可提交' : win === 'late' ? '逾期补交' : a.my ? '重新提交(覆盖)' : '提交作业'}</button>
      </div>`;

    if (needFile) {
      const dz = page.querySelector('#dz') as HTMLElement;
      const fin = page.querySelector('#file-in') as HTMLInputElement;
      dz.querySelector('.fname')!.textContent = state.file ? `${state.file.name}(${fmtSize(state.file.size)})` : '';
      const pick = (f: File | null | undefined) => {
        if (!f) return;
        if (f.size > MAX_FILE) { toast('文件超过 8MB 上限', 'err'); return; }
        state.file = f;
        dz.querySelector('.fname')!.textContent = `${f.name}(${fmtSize(f.size)})`;
      };
      dz.addEventListener('click', () => fin.click());
      fin.addEventListener('change', () => pick(fin.files?.[0]));
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); pick(e.dataTransfer?.files?.[0]); });
    }

    if (needText) {
      const ta = page.querySelector('#txt-in') as HTMLTextAreaElement;
      ta.dataset.init = textInit; // 脏输入追踪基准
      ta.addEventListener('input', () => sessionStorage.setItem(draftKey, ta.value));
    }

    page.querySelector('#submit-btn')!.addEventListener('click', async () => {
      const btn = page.querySelector('#submit-btn') as HTMLButtonElement;
      const content = needText ? (page.querySelector('#txt-in') as HTMLTextAreaElement).value : null;
      if (a.submitType === 'text' && !content?.trim()) { toast('请填写作业内容', 'err'); return; }
      if (a.submitType === 'file' && !state.file && !a.my?.fileName) { toast('请选择要提交的文件', 'err'); return; }
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        const body: Record<string, unknown> = {};
        if (content?.trim()) body.content = content;
        if (state.file) {
          body.fileName = state.file.name;
          body.fileB64 = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
            r.onerror = () => reject(new Error('读取文件失败'));
            r.readAsDataURL(state.file!);
          });
        } else if (a.submitType === 'file' && a.my?.fileName) {
          // 未换文件且原本有文件:后端覆盖逻辑要求重新传,提示用户重新选择
          if (!body.content) throw new Error('请重新选择要提交的文件');
        }
        await api(`/api/assignments/${id}/submit`, { method: 'POST', body });
        state.file = null;
        sessionStorage.removeItem(draftKey);
        toast('提交成功!', 'ok');
        const fresh = await api<Detail>(`/api/assignments/${id}`);
        lastFp = JSON.stringify(fresh);
        applyDetail(fresh, false);
      } catch (e) {
        toast((e as Error).message, 'err');
        btn.disabled = false;
        btn.textContent = win === 'late' ? '逾期补交' : a.my ? '重新提交(覆盖)' : '提交作业';
      }
    });

    // ---- 我的提交状态 ----
    const myArea = page.querySelector('.my-area') as HTMLElement;
    if (a.my) {
      const my = a.my;
      myArea.innerHTML = `
        <div class="card"><h3>我的提交</h3>
          <table class="tbl"><tbody>
            <tr><td class="muted" style="width:110px">提交时间</td><td>${fmtDT(my.submittedAt)}</td></tr>
            <tr><td class="muted">状态</td><td>${my.isLate ? '<span class="badge orange">逾期提交</span>' : '<span class="badge green">按时提交</span>'} · 第 ${my.attemptCount} 次提交</td></tr>
            ${my.fileName ? `<tr><td class="muted">文件</td><td>${esc(my.fileName)} <button class="btn ghost sm" id="dl-my">下载</button></td></tr>` : ''}
            ${my.content ? `<tr><td class="muted">文本内容</td><td style="white-space:pre-wrap">${esc(my.content)}</td></tr>` : ''}
            ${my.score != null ? `<tr><td class="muted">成绩</td><td><b style="color:var(--green)">${my.score}</b> 分${my.comment ? ' · 评语:' + esc(my.comment) : ''}</td></tr>` : '<tr><td class="muted">成绩</td><td class="muted">待批阅</td></tr>'}
            ${(my.history?.length ?? 0) ? `<tr><td class="muted">历史版本</td><td class="muted" style="font-size:12px">${my.history!.map(h => fmtDT(h.submittedAt) + (h.fileName ? `(${esc(h.fileName)})` : '')).join('<br>')}</td></tr>` : ''}
          </tbody></table>
        </div>`;
      myArea.querySelector('#dl-my')?.addEventListener('click', () =>
        apiDownload(`/api/files/${my.id}`, my.fileName ?? 'file'));
    }
  };

  const load = async () => {
    try {
      const a = await api<Detail>(`/api/assignments/${id}`);
      const fp = JSON.stringify(a);
      const changed = lastFp !== '' && fp !== lastFp;
      lastFp = fp;
      return { a, changed };
    } catch (e) {
      if (lastFp === '') page.innerHTML = `<div class="card">${esc((e as Error).message)}</div>`;
      return null;
    }
  };

  const first = await load();
  if (first) applyDetail(first.a, false);

  // 30s 轮询:正在输入/已选文件/有未保存草稿时让路;数据指纹不变不重绘
  addPageTimer(setInterval(async () => {
    if (busyInput(page) || state.file) return;
    const r = await load();
    if (r && r.changed) applyDetail(r.a, true);
  }, 30_000));
}
