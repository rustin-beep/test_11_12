/** 教师端 · 班级名单(多班):建班/删班、单个添加、CSV 批量导入 */
import { api } from '../api.ts';
import { topbar } from '../components/topbar.ts';
import { esc, toast, modal, confirmDlg } from '../ui.ts';
import type { ClassInfo, StudentRow } from '../../../shared/types.ts';

export async function renderTeacherRoster(root: HTMLElement) {
  topbar(root, 'roster');
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  let classes: ClassInfo[] = [];
  let classId = Number(localStorage.getItem('hw_class') ?? 0);

  const renderClass = async () => {
    const students = classId ? await api<StudentRow[]>(`/api/classes/${classId}/students`) : [];
    page.innerHTML = `
      <div class="page-head"><h2 class="page-title">班级名单</h2></div>
      <div class="card">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
          <select id="cls-sel" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font:inherit">
            ${classes.map(c => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${esc(c.name)}(${c.studentCount}人)</option>`).join('')}
          </select>
          <button class="btn sm" id="cls-new">新建班级</button>
          <button class="btn sm danger" id="cls-del" ${classId ? '' : 'disabled'}>删除班级</button>
        </div>
        <table class="tbl">
          <thead><tr><th style="width:180px">学号</th><th>姓名</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>
            <tr><td><input class="inline-input" id="add-no" placeholder="学号" style="width:150px"></td>
                <td><input class="inline-input" id="add-name" placeholder="姓名" style="width:120px"></td>
                <td style="text-align:right"><button class="btn sm primary" id="add-go">+ 添加学生</button></td></tr>
            ${students.map(s => `<tr>
              <td>${esc(s.studentNo)}</td><td>${esc(s.name)}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn ghost sm" data-rp="${s.id}" data-no="${esc(s.studentNo)}" data-name="${esc(s.name)}">重置密码</button>
                <button class="btn sm danger" data-rm="${s.id}" data-no="${esc(s.studentNo)}">移出班级</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p class="muted" style="font-size:12px;margin-bottom:0">新学生初始密码默认为学号;已有学号的学生加入新班级时保留原密码。</p>
      </div>
      <div class="card">
        <h3>CSV 批量导入</h3>
        <p class="muted" style="font-size:13px;margin-top:0">每行:<code>学号,姓名[,初始密码]</code>(密码可省略,默认为学号;首行可以是表头,将自动跳过)</p>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="file" id="csv-file" accept=".csv,.txt" style="display:none">
          <button class="btn sm" id="csv-pick">选择 CSV 文件</button>
          <button class="btn sm ghost" id="csv-tpl">下载模板</button>
        </div>
        <textarea id="csv-text" rows="6" placeholder="2025001,张三&#10;2025002,李四,abc123" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13px"></textarea>
        <div class="row-end"><button class="btn primary" id="csv-go" ${classId ? '' : 'disabled'}>导入到当前班级</button></div>
        <div id="csv-result"></div>
      </div>`;

    const sel = page.querySelector('#cls-sel') as HTMLSelectElement;
    sel.addEventListener('change', async () => { classId = Number(sel.value); localStorage.setItem('hw_class', String(classId)); renderClass(); });

    page.querySelector('#cls-new')!.addEventListener('click', () => {
      const ov = modal('新建班级', `
        <label>班级名称(默认专业已预填,补上班号即可)<input id="nc-name" value="电气工程及其自动化" placeholder="如:电气工程及其自动化 2301 班"></label>
        <div class="row-end"><button class="btn" id="nc-cancel">取消</button><button class="btn primary" id="nc-ok">创建</button></div>`);
      ov.querySelector('#nc-cancel')!.addEventListener('click', () => ov.remove());
      ov.querySelector('#nc-ok')!.addEventListener('click', async () => {
        const name = (ov.querySelector('#nc-name') as HTMLInputElement).value.trim();
        if (!name) { toast('班级名不能为空', 'err'); return; }
        try {
          await api('/api/classes', { method: 'POST', body: { name } });
          toast('班级已创建', 'ok'); ov.remove(); await refresh();
        } catch (e) { toast((e as Error).message, 'err'); }
      });
    });

    page.querySelector('#cls-del')!.addEventListener('click', async () => {
      const c = classes.find(x => x.id === classId);
      if (!c) return;
      if (!await confirmDlg(`确定删除班级「${c.name}」?该班全部作业及提交记录会一并删除。`)) return;
      try { await api(`/api/classes/${classId}`, { method: 'DELETE' }); toast('已删除', 'ok'); classId = 0; await refresh(); }
      catch (e) { toast((e as Error).message, 'err'); }
    });

    page.querySelector('#add-go')!.addEventListener('click', async () => {
      const no = (page.querySelector('#add-no') as HTMLInputElement).value.trim();
      const name = (page.querySelector('#add-name') as HTMLInputElement).value.trim();
      if (!no || !name) { toast('学号和姓名都要填', 'err'); return; }
      try {
        await api(`/api/classes/${classId}/students`, { method: 'POST', body: { studentNo: no, name } });
        toast(`已添加 ${name}`, 'ok'); renderClass();
      } catch (e) { toast((e as Error).message, 'err'); }
    });

    page.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', async () => {
      const no = (b as HTMLElement).dataset.no!, name = (b as HTMLElement).dataset.name!;
      if (!await confirmDlg(`将 ${name}(${no}) 的密码重置为学号「${no}」?`)) return;
      try {
        await api(`/api/students/${(b as HTMLElement).dataset.rp}/reset-password`, { method: 'POST' });
        toast(`已重置,${name} 现在用学号 ${no} 登录`, 'ok');
      } catch (e) { toast((e as Error).message, 'err'); }
    }));

    page.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
      const sid = Number((b as HTMLElement).dataset.rm);
      const no = (b as HTMLElement).dataset.no!;
      if (!await confirmDlg(`将学号 ${no} 移出本班?(其账号与提交记录保留)`)) return;
      try { await api(`/api/classes/${classId}/students/${sid}`, { method: 'DELETE' }); renderClass(); }
      catch (e) { toast((e as Error).message, 'err'); }
    }));

    page.querySelector('#csv-pick')!.addEventListener('click', () => (page.querySelector('#csv-file') as HTMLInputElement).click());
    (page.querySelector('#csv-file') as HTMLInputElement).addEventListener('change', e => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { (page.querySelector('#csv-text') as HTMLTextAreaElement).value = String(r.result); };
      r.readAsText(f, 'utf-8');
    });
    page.querySelector('#csv-tpl')!.addEventListener('click', () => {
      const blob = new Blob(['\uFEFF学号,姓名,初始密码(可省略)\r\n2025001,张三\r\n2025002,李四\r\n'], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '名单模板.csv';
      a.click();
    });
    page.querySelector('#csv-go')!.addEventListener('click', async () => {
      const csv = (page.querySelector('#csv-text') as HTMLTextAreaElement).value.trim();
      if (!csv) { toast('请粘贴名单或选择文件', 'err'); return; }
      try {
        const r = await api<{ added: number; skipped: number; errors: string[] }>(`/api/classes/${classId}/import`, { method: 'POST', body: { csv } });
        toast(`导入完成:新增 ${r.added} 人,跳过 ${r.skipped} 人`, r.skipped ? 'info' : 'ok');
        (page.querySelector('#csv-result') as HTMLElement).innerHTML =
          r.errors.length ? `<div class="banner warn" style="margin:10px 0 0">${r.errors.map(esc).join('<br>')}</div>` : '';
        await refresh();
      } catch (e) { toast((e as Error).message, 'err'); }
    });
  };

  const refresh = async () => {
    classes = await api<ClassInfo[]>('/api/classes');
    if (!classes.find(c => c.id === classId)) classId = classes[0]?.id ?? 0;
    localStorage.setItem('hw_class', String(classId));
    await renderClass();
  };
  await refresh().catch(e => toast((e as Error).message, 'err'));
}
