/** 教师端 · 作业管理:列表 + 发布/编辑(含截止时间修改) + 删除 */
import { api } from '../api.ts';
import { topbar } from '../components/topbar.ts';
import { esc, toast, modal, confirmDlg } from '../ui.ts';
import { now } from '../clock.ts';
import { fmtDT, toLocalInput, fromLocalInput } from '../lib/time.ts';
import { addPageTimer } from '../lib/timers.ts';
import { submitWindow } from '../../../shared/types.ts';
import type { TeacherAssignment, ClassInfo } from '../../../shared/types.ts';

export async function renderTeacherAssignments(root: HTMLElement) {
  topbar(root, 'assignments');
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  let lastFp = '';
  const renderTable = async () => {
    const [classes, list] = await Promise.all([
      api<ClassInfo[]>('/api/classes'),
      api<TeacherAssignment[]>('/api/assignments'),
    ]);
    const fp = JSON.stringify([classes, list]);
    if (fp === lastFp) return; // 数据没变不重绘
    lastFp = fp;
    const nowMs = now();
    const rowOf = (a: TeacherAssignment) => {
      const win = submitWindow(a, nowMs);
      const st = win === 'open' ? '<span class="badge green">进行中</span>'
        : win === 'late' ? '<span class="badge orange">补交中</span>' : '<span class="badge red">已截止</span>';
      return { st, actions: `
        <a class="btn sm" href="#/teacher/stats/${a.id}">统计</a>
        <button class="btn sm" data-edit="${a.id}">编辑</button>
        <button class="btn sm danger" data-del="${a.id}">删除</button>` };
    };
    page.innerHTML = `
      <div class="page-head">
        <h2 class="page-title">作业管理</h2>
        <button class="btn primary" id="btn-new">+ 发布作业</button>
      </div>
      <div class="card">
        ${list.length ? `
        <!-- 桌面:表格 -->
        <table class="tbl hw-admin-tbl">
          <thead><tr><th>班级</th><th>标题</th><th>截止时间</th><th>进度</th><th>已批</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>
          ${list.map(a => {
            const r = rowOf(a);
            return `<tr>
              <td>${esc(a.className)}</td>
              <td><b>${esc(a.title)}</b></td>
              <td>${fmtDT(a.deadline)}${a.allowLate ? `<br><span class="muted" style="font-size:12px">补交至 ${fmtDT(a.lateDeadline)}</span>` : ''}</td>
              <td>${a.submitted} / ${a.total}</td>
              <td>${a.scored} / ${a.submitted}</td>
              <td>${r.st}</td>
              <td style="text-align:right;white-space:nowrap">${r.actions}</td>
            </tr>`;
          }).join('')}
          </tbody></table>
        <!-- 手机:卡片(操作始终可见,免横向滚动) -->
        <div class="hw-admin-cards">
          ${list.map(a => {
            const r = rowOf(a);
            return `<div class="hw-admin-card">
              <div class="hw-admin-top"><b>${esc(a.title)}</b>${r.st}</div>
              <div class="muted" style="font-size:12px">${esc(a.className)}</div>
              <div style="font-size:13px;margin-top:6px">截止 ${fmtDT(a.deadline)}${a.allowLate ? ` · 补交至 ${fmtDT(a.lateDeadline)}` : ''}</div>
              <div style="font-size:13px;margin-top:2px">已交 <b>${a.submitted}</b>/${a.total} · 已批 <b>${a.scored}</b>/${a.submitted}</div>
              <div class="hw-admin-actions">${r.actions}</div>
            </div>`;
          }).join('')}
        </div>` : `<div class="muted" style="padding:20px;text-align:center">还没有作业,点右上角「发布作业」新建;发布前请先在「班级名单」建班导名单。</div>`}
      </div>`;

    page.querySelector('#btn-new')!.addEventListener('click', () => form(classes, null, renderTable));
    page.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => form(classes, list.find(x => x.id === Number((b as HTMLElement).dataset.edit))!, renderTable)));
    page.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = Number((b as HTMLElement).dataset.del);
        const a = list.find(x => x.id === id)!;
        if (!await confirmDlg(`确定删除作业《${a.title}》?其所有提交记录将一并删除。`)) return;
        try { await api(`/api/assignments/${id}`, { method: 'DELETE' }); toast('已删除', 'ok'); renderTable(); }
        catch (e) { toast((e as Error).message, 'err'); }
      }));
  };

  await renderTable().catch(e => toast((e as Error).message, 'err'));
  addPageTimer(setInterval(renderTable, 30_000));
}

/** 发布 / 编辑作业表单(modal) */
function form(classes: ClassInfo[], a: TeacherAssignment | null, done: () => void) {
  if (!classes.length) { toast('请先到「班级名单」创建班级并导入学生', 'err'); return; }
  const deadline = a?.deadline ?? Date.now() + 86400_000;
  const ov = modal(a ? `编辑作业《${a.title}》` : '发布作业', `
    <label>班级<select id="f-class">${classes.map(c =>
      `<option value="${c.id}" ${a?.classId === c.id ? 'selected' : ''}>${esc(c.name)}(${c.studentCount}人)</option>`).join('')}</select></label>
    <label>标题<input id="f-title" value="${esc(a?.title ?? '')}" placeholder="如:电气工程实践报告"></label>
    <label>说明<textarea id="f-desc" rows="3" placeholder="作业要求、格式等,如:完成三相异步电动机正反转控制线路设计并提交报告(可选)">${esc(a?.description ?? '')}</textarea></label>
    <label>提交截止时间<input id="f-dl" type="datetime-local" value="${toLocalInput(deadline)}"></label>
    <div class="check-row"><input type="checkbox" id="f-late" ${a?.allowLate ? 'checked' : ''}><label style="margin:0" for="f-late">允许逾期补交(补交的标记为「逾期提交」)</label></div>
    <label>补交截止时间(勾选补交时必填)<input id="f-ldl" type="datetime-local" value="${toLocalInput((a?.lateDeadline ?? Date.now() + 86400_000 * 2))}"></label>
    <label>提交类型<select id="f-type">
      <option value="both" ${a?.submitType === 'both' ? 'selected' : ''}>文件或文本均可</option>
      <option value="file" ${a?.submitType === 'file' ? 'selected' : ''}>仅上传文件</option>
      <option value="text" ${a?.submitType === 'text' ? 'selected' : ''}>仅填写文本</option>
    </select></label>
    <div class="row-end"><button class="btn" id="f-cancel">取消</button><button class="btn primary" id="f-ok">${a ? '保存(学生端将收到更新)' : '发布'}</button></div>`);

  ov.querySelector('#f-cancel')!.addEventListener('click', () => ov.remove());
  ov.querySelector('#f-ok')!.addEventListener('click', async () => {
    const body = {
      classId: Number((ov.querySelector('#f-class') as HTMLSelectElement).value),
      title: (ov.querySelector('#f-title') as HTMLInputElement).value,
      description: (ov.querySelector('#f-desc') as HTMLTextAreaElement).value,
      deadline: fromLocalInput((ov.querySelector('#f-dl') as HTMLInputElement).value),
      allowLate: (ov.querySelector('#f-late') as HTMLInputElement).checked,
      lateDeadline: (ov.querySelector('#f-late') as HTMLInputElement).checked
        ? fromLocalInput((ov.querySelector('#f-ldl') as HTMLInputElement).value) : null,
      submitType: (ov.querySelector('#f-type') as HTMLSelectElement).value,
    };
    if (!body.title.trim()) { toast('标题不能为空', 'err'); return; }
    if (!Number.isFinite(body.deadline)) { toast('截止时间无效', 'err'); return; }
    try {
      await api(a ? `/api/assignments/${a.id}` : '/api/assignments', { method: a ? 'PUT' : 'POST', body });
      toast(a ? '已保存,学生端稍后会自动更新' : '发布成功', 'ok');
      ov.remove();
      done();
    } catch (e) { toast((e as Error).message, 'err'); }
  });
}
