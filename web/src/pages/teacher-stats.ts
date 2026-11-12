/** 教师端 · 提交统计:缺交名单 / 批阅打分 / 简版查重 / CSV 导出 / 改截止时间 */
import { api, apiDownload, apiBlob, PREVIEW_TEXT_EXT, PREVIEW_IMG_EXT } from '../api.ts';
import { topbar } from '../components/topbar.ts';
import { esc, toast, modal } from '../ui.ts';
import { fmtDT, toLocalInput, fromLocalInput } from '../lib/time.ts';
import { addPageTimer } from '../lib/timers.ts';
import { busyInput } from '../lib/dom.ts';
import type { AssignmentStats, StatsSubmission } from '../../../shared/types.ts';

export async function renderTeacherStats(root: HTMLElement, m: RegExpMatchArray) {
  topbar(root, 'assignments');
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);
  const id = m[1];

  let lastFp = '';
  const render = async (force = false) => {
    // 轮询时若有未保存的批阅输入/焦点在表格内,让路(防丢输入)
    if (!force && busyInput(page)) return;
    let s: AssignmentStats;
    try { s = await api<AssignmentStats>(`/api/assignments/${id}/stats`); }
    catch (e) { page.innerHTML = `<div class="card">${esc((e as Error).message)}</div>`; return; }
    const fp = JSON.stringify(s);
    if (!force && fp === lastFp) return; // 数据没变不重绘
    lastFp = fp;
    cur = s; // 供"查看"弹窗取行数据
    const a = s.assignment;
    const scored = s.onTime.filter(x => x.score != null).length + s.late.filter(x => x.score != null).length;

    page.innerHTML = `
      <div class="page-head">
        <h2 class="page-title">《${esc(a.title)}》<span class="badge gray" style="vertical-align:middle">${esc(a.className)}</span></h2>
        <div style="display:flex;gap:8px">
          <a href="#/teacher" class="btn ghost sm">← 返回</a>
          <button class="btn sm" id="st-dl">导出 CSV</button>
          <button class="btn sm primary" id="st-edit">修改截止时间</button>
        </div>
      </div>
      <div class="muted" style="margin:-8px 0 14px;font-size:13px">截止:${fmtDT(a.deadline)}${a.allowLate ? ` · 补交至 ${fmtDT(a.lateDeadline)}` : ''} · 信息版本 v${a.version}(修改后学生端 ≤30s 内自动刷新)</div>

      <div class="stat-row">
        <div class="stat-card b"><b>${s.total}</b><span>应交人数</span></div>
        <div class="stat-card g"><b>${s.onTime.length}</b><span>按时已交</span></div>
        <div class="stat-card o"><b>${s.late.length}</b><span>逾期已交</span></div>
        <div class="stat-card r"><b>${s.missing.length}</b><span>未交</span></div>
        <div class="stat-card"><b>${scored}</b><span>已批阅</span></div>
      </div>

      <div class="card"><h3>未交名单(${s.missing.length})</h3>
        ${s.missing.length
          ? `<div class="missing-list">${s.missing.map(x => `<span class="missing-item">${esc(x.studentNo)} ${esc(x.name)}</span>`).join('')}</div>`
          : '<span class="muted">全员已交 ✓</span>'}
      </div>

      ${(s.duplicates.length || s.similar.length) ? `
      <div class="card"><h3>疑似互抄(简版查重)</h3>
        ${s.duplicates.map(g => `<div class="dup-item">📄 文件完全相同(${esc(g.md5.slice(0, 8))}…):${g.members.map(x => `${esc(x.studentNo)} ${esc(x.name)}`).join('、')}</div>`).join('')}
        ${s.similar.slice(0, 15).map(p => `<div class="dup-item">📎 文本相似 ${(p.similarity * 100).toFixed(0)}%:${esc(p.a.studentNo)} ${esc(p.a.name)} ↔ ${esc(p.b.studentNo)} ${esc(p.b.name)}</div>`).join('')}
        ${s.similar.length > 15 ? `<div class="dup-item muted">… 仅列相似度最高的前 15 对,共 ${s.similar.length} 对</div>` : ''}
        <p class="muted" style="font-size:12px;margin-bottom:0">相同文件按 MD5 分组;文本相似按 Simhash 海明距离判定,仅供参考。</p>
      </div>` : ''}

      <div class="card"><h3>已交名单(${s.onTime.length + s.late.length})</h3>
        ${s.onTime.length + s.late.length ? `
        <!-- 桌面:表格 -->
        <table class="tbl sub-tbl">
          <thead><tr><th>学号</th><th>姓名</th><th>状态</th><th>提交时间</th><th>次数</th><th>文件</th><th>分数</th><th>评语</th><th></th></tr></thead>
          <tbody>${[...s.onTime, ...s.late].map(rowHtml).join('')}</tbody>
        </table>
        <!-- 手机:卡片 -->
        <div class="sub-cards">${[...s.onTime, ...s.late].map(cardHtml).join('')}</div>` : '<span class="muted">还没有人提交</span>'}
      </div>`;

    page.querySelector('#st-dl')!.addEventListener('click', () =>
      apiDownload(`/api/assignments/${id}/export`, `${a.title}-成绩单.csv`));

    page.querySelector('#st-edit')!.addEventListener('click', () => {
      const ov = modal('修改截止时间(学生端将自动更新)', `
        <label>提交截止时间<input id="e-dl" type="datetime-local" value="${toLocalInput(a.deadline)}"></label>
        <div class="check-row"><input type="checkbox" id="e-late" ${a.allowLate ? 'checked' : ''}><label style="margin:0" for="e-late">允许逾期补交</label></div>
        <label>补交截止时间<input id="e-ldl" type="datetime-local" value="${toLocalInput(a.lateDeadline ?? Date.now() + 86400_000)}"></label>
        <div class="row-end"><button class="btn" id="e-cancel">取消</button><button class="btn primary" id="e-ok">保存</button></div>`);
      ov.querySelector('#e-cancel')!.addEventListener('click', () => ov.remove());
      ov.querySelector('#e-ok')!.addEventListener('click', async () => {
        const body = {
          title: a.title, description: a.description, submitType: a.submitType,
          deadline: fromLocalInput((ov.querySelector('#e-dl') as HTMLInputElement).value),
          allowLate: (ov.querySelector('#e-late') as HTMLInputElement).checked,
          lateDeadline: (ov.querySelector('#e-late') as HTMLInputElement).checked
            ? fromLocalInput((ov.querySelector('#e-ldl') as HTMLInputElement).value) : null,
        };
        try {
          await api(`/api/assignments/${a.id}`, { method: 'PUT', body });
          toast('已保存,已逾期的作业将在学生端恢复可提交(若延长了时间)', 'ok');
          ov.remove(); render();
        } catch (e) { toast((e as Error).message, 'err'); }
      });
    });

    page.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', async () => {
      const btn = b as HTMLElement;
      const sid = btn.dataset.save!;
      const scope = btn.closest('tr') ?? btn.closest('.sub-card')!;
      const scoreRaw = (scope.querySelector('.score-in') as HTMLInputElement).value.trim();
      const comment = (scope.querySelector('.comment-in') as HTMLInputElement).value.trim();
      try {
        await api(`/api/submissions/${sid}/score`, {
          method: 'PUT',
          body: { score: scoreRaw === '' ? null : Number(scoreRaw), comment: comment || null },
        });
        toast('已保存', 'ok');
        // 清掉本行脏标记再刷新;若其他行还有未保存输入,刷新会自动让路
        scope.querySelectorAll('.score-in, .comment-in').forEach(i => i.removeAttribute('data-dirty'));
        render();
      } catch (e) { toast((e as Error).message, 'err'); }
    }));
  };

  const rowHtml = (x: StatsSubmission) => `
    <tr>
      <td>${esc(x.studentNo)}</td><td>${esc(x.name)}</td>
      <td>${x.isLate ? '<span class="badge orange">逾期</span>' : '<span class="badge green">按时</span>'}</td>
      <td style="white-space:nowrap">${fmtDT(x.submittedAt)}</td>
      <td>${x.attemptCount}</td>
      <td><button class="btn ghost sm" data-view="${x.submissionId}">查看</button>${x.fileName ? ` <button class="btn ghost sm" data-dl="${x.submissionId}" data-fn="${esc(x.fileName)}">下载</button>` : ''}</td>
      <td><input class="inline-input score-in" value="${x.score ?? ''}" data-init="${x.score ?? ''}" placeholder="分数"></td>
      <td><input class="inline-input comment-in" style="width:160px" value="${esc(x.comment ?? '')}" data-init="${esc(x.comment ?? '')}" placeholder="评语"></td>
      <td><button class="btn sm primary" data-save="${x.submissionId}">保存</button></td>
    </tr>`;

  /** 手机版提交卡片:信息竖排,批阅与操作直接可见 */
  const cardHtml = (x: StatsSubmission) => `
    <div class="sub-card">
      <div class="sub-card-top">
        <b>${esc(x.studentNo)} ${esc(x.name)}</b>
        ${x.isLate ? '<span class="badge orange">逾期</span>' : '<span class="badge green">按时</span>'}
      </div>
      <div class="muted" style="font-size:12px;margin-top:2px">第 ${x.attemptCount} 次提交 · ${fmtDT(x.submittedAt)}${x.fileName ? ` · ${esc(x.fileName)}` : x.content ? ' · 文本' : ''}</div>
      <div class="sub-card-actions">
        <button class="btn sm" data-view="${x.submissionId}">查看</button>
        ${x.fileName ? `<button class="btn sm" data-dl="${x.submissionId}" data-fn="${esc(x.fileName)}">下载</button>` : ''}
        <span class="score-wrap"><input class="inline-input score-in" style="width:64px" value="${x.score ?? ''}" data-init="${x.score ?? ''}" placeholder="分数">
        <input class="inline-input comment-in" style="flex:1;min-width:0" value="${esc(x.comment ?? '')}" data-init="${esc(x.comment ?? '')}" placeholder="评语">
        <button class="btn sm primary" data-save="${x.submissionId}">保存</button></span>
      </div>
    </div>`;

  page.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('[data-dl]') as HTMLElement | null;
    if (t) apiDownload(`/api/files/${t.dataset.dl}`, t.dataset.fn ?? 'file');
    const v = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (v) openView(Number(v.dataset.view));
  });

  // ---- 在线查看学生提交(文本/代码/图片直接预览,弹窗内批阅) ----
  let cur: AssignmentStats | null = null;
  function openView(sid: number) {
    const x = cur && [...cur.onTime, ...cur.late].find(s => s.submissionId === sid);
    if (!x) return;
    const ov = modal(`${x.studentNo} ${x.name} 的提交`, `
      <table class="tbl"><tbody>
        <tr><td class="muted" style="width:90px">状态</td><td>${x.isLate ? '<span class="badge orange">逾期提交</span>' : '<span class="badge green">按时提交</span>'} · 第 ${x.attemptCount} 次提交 · ${fmtDT(x.submittedAt)}</td></tr>
        ${x.fileName ? `<tr><td class="muted">文件</td><td>${esc(x.fileName)} <button class="btn ghost sm" id="vw-dl">下载</button> <span class="muted" id="vw-hint" style="font-size:12px"></span></td></tr>
          <tr id="vw-row" hidden><td class="muted">内容预览</td><td style="width:100%">
            <pre id="vw-pre" hidden style="white-space:pre-wrap;word-break:break-all;background:#f6f8fa;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px;line-height:1.6;max-height:300px;overflow:auto;margin:0;font-family:ui-monospace,Consolas,monospace"></pre>
            <img id="vw-img" hidden style="max-width:100%;border-radius:8px;border:1px solid var(--line)" alt="提交的图片">
          </td></tr>` : ''}
        ${x.content ? `<tr><td class="muted">文本内容</td><td style="white-space:pre-wrap">${esc(x.content)}</td></tr>` : ''}
      </tbody></table>
      <label style="margin-top:14px">分数<input id="vw-score" inputmode="decimal" value="${x.score ?? ''}" placeholder="分数"></label>
      <label>评语<input id="vw-comment" value="${esc(x.comment ?? '')}" placeholder="评语"></label>
      <div class="row-end"><button class="btn" id="vw-close">关闭</button><button class="btn primary" id="vw-save">保存批阅</button></div>`);

    if (x.fileName) {
      const ext = x.fileName.slice(x.fileName.lastIndexOf('.')).toLowerCase();
      const hint = ov.querySelector('#vw-hint') as HTMLElement;
      ov.querySelector('#vw-dl')!.addEventListener('click', () => apiDownload(`/api/files/${sid}`, x.fileName!));
      if (PREVIEW_TEXT_EXT.has(ext)) {
        hint.textContent = '内容加载中…';
        apiBlob(`/api/files/${sid}`)
          .then(b => b.text())
          .then(txt => {
            (ov.querySelector('#vw-pre') as HTMLElement).textContent = txt.slice(0, 20000);
            (ov.querySelector('#vw-pre') as HTMLElement).hidden = false;
            (ov.querySelector('#vw-row') as HTMLElement).hidden = false;
            hint.textContent = txt.length > 20000 ? '(仅显示前 2 万字符)' : '';
          })
          .catch(() => { hint.textContent = '(预览加载失败,请下载查看)'; });
      } else if (PREVIEW_IMG_EXT.has(ext)) {
        hint.textContent = '图片加载中…';
        apiBlob(`/api/files/${sid}`)
          .then(b => {
            const img = ov.querySelector('#vw-img') as HTMLImageElement;
            img.src = URL.createObjectURL(b);
            img.hidden = false;
            (ov.querySelector('#vw-row') as HTMLElement).hidden = false;
            hint.textContent = '';
          })
          .catch(() => { hint.textContent = '(预览加载失败,请下载查看)'; });
      } else {
        hint.textContent = '(该格式不支持在线预览,请下载查看)';
      }
    }
    ov.querySelector('#vw-close')!.addEventListener('click', () => ov.remove());
    ov.querySelector('#vw-save')!.addEventListener('click', async () => {
      const scoreRaw = (ov.querySelector('#vw-score') as HTMLInputElement).value.trim();
      const comment = (ov.querySelector('#vw-comment') as HTMLInputElement).value.trim();
      try {
        await api(`/api/submissions/${sid}/score`, {
          method: 'PUT',
          body: { score: scoreRaw === '' ? null : Number(scoreRaw), comment: comment || null },
        });
        toast('批阅已保存', 'ok');
        ov.remove();
        render(); // 刷新统计(已批数等)
      } catch (e) { toast((e as Error).message, 'err'); }
    });
  }

  await render().catch(e => toast((e as Error).message, 'err'));
  addPageTimer(setInterval(render, 30_000));
}
