/**
 * 静态演示版"浏览器后端":与 server/server.ts 接口语义一致,
 * 数据存 localStorage/IndexedDB,同一浏览器的所有标签页共享(storge 事件 + 轮询感知)。
 * 仅供作业展示;真实多设备共享请使用 Node 后端版本。
 */
import { loadDb, saveDb, nextId, hashPassword, verifyPassword, putFile, getFile, type Db, type DbSubmission, type DbUser } from './idb.ts';
import { ensureSeed } from './seed.ts';
import { hamming, simhash } from '../../../server/util/simhash.ts';
import { submitWindow } from '../../../shared/types.ts';
import { parseCsv, toCsv } from '../../../server/util/csv.ts';
import type { User } from '../../../shared/types.ts';

export class MockError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 每次请求现读 localStorage:多标签页共享一份数据,杜绝陈旧缓存互相覆盖 */
async function getDb(): Promise<Db> {
  const d = loadDb();
  if (d.users.length === 0) await ensureSeed(d);
  return d;
}

const nowUser = async (token: string): Promise<User> => {
  const d = await getDb();
  const sess = d.sessions[token];
  if (!sess || sess.exp < Date.now()) throw new MockError(401, '未登录或登录已过期');
  const u = d.users.find(x => x.id === sess.uid)!;
  return { id: u.id, login: u.login, studentNo: u.studentNo, name: u.name, role: u.role };
};
const mustTeacher = async (token: string) => {
  const u = await nowUser(token);
  if (u.role !== 'teacher') throw new MockError(403, '需要教师权限');
  return u;
};

const dtoA = (a: any) => ({
  id: a.id, classId: a.classId, className: a.className ?? '', title: a.title, description: a.description,
  deadline: a.deadline, allowLate: a.allowLate, lateDeadline: a.lateDeadline,
  submitType: a.submitType, version: a.version, createdAt: a.createdAt,
});
const mySub = (d: Db, uid: number, aid: number) => {
  const s = d.submissions.find(x => x.assignmentId === aid && x.studentId === uid);
  if (!s) return null;
  return {
    id: s.id, submittedAt: s.submittedAt, isLate: s.isLate, attemptCount: s.attemptCount,
    fileName: s.fileName, content: s.content, score: s.score, comment: s.comment, scoredAt: s.scoredAt,
    history: d.history.filter(h => h.submissionId === s.id)
      .map(h => ({ content: h.content, fileName: h.fileName, submittedAt: h.submittedAt })).reverse(),
  };
};

async function handle(path: string, method: string, body: any, token: string): Promise<any> {
  const d = await getDb();
  let m: RegExpMatchArray | null;

  if (path === '/api/login' && method === 'POST') {
    const u = d.users.find(x => x.login === String(body?.login ?? ''));
    if (!u || !(await verifyPassword(String(body?.password ?? ''), u.passSalt, u.passHash)))
      throw new MockError(401, '用户名或密码错误');
    const token = crypto.randomUUID();
    d.sessions[token] = { uid: u.id, exp: Date.now() + 12 * 3600_000 };
    saveDb(d);
    return { token, user: { id: u.id, login: u.login, studentNo: u.studentNo, name: u.name, role: u.role } };
  }

  const me = await nowUser(token);

  if (path === '/api/me' && method === 'GET') return me;

  if (path === '/api/change-password' && method === 'POST') {
    const u = d.users.find(x => x.id === me.id)!;
    if (!(await verifyPassword(String(body?.oldPassword ?? ''), u.passSalt, u.passHash))) throw new MockError(400, '原密码错误');
    const nw = String(body?.newPassword ?? '');
    if (nw.length < 4) throw new MockError(400, '新密码至少 4 位');
    const p = await hashPassword(nw);
    u.passSalt = p.salt; u.passHash = p.hash;
    saveDb(d);
    return { ok: true };
  }

  // ---- 班级 ----
  if (path === '/api/classes') {
    if (method === 'GET') {
      await mustTeacher(token);
      return d.classes.map(c => ({ id: c.id, name: c.name, studentCount: d.enrollments.filter(e => e.classId === c.id).length }));
    }
    if (method === 'POST') {
      await mustTeacher(token);
      const name = String(body?.name ?? '').trim();
      if (!name) throw new MockError(400, '班级名不能为空');
      if (d.classes.some(c => c.name === name)) throw new MockError(409, '班级已存在');
      d.classes.push({ id: nextId(d), name, createdAt: Date.now() });
      saveDb(d);
      return { ok: true };
    }
  }

  if ((m = path.match(/^\/api\/classes\/(\d+)$/)) && method === 'DELETE') {
    await mustTeacher(token);
    const cid = Number(m[1]);
    d.classes = d.classes.filter(c => c.id !== cid);
    d.enrollments = d.enrollments.filter(e => e.classId !== cid);
    const aids = d.assignments.filter(a => a.classId === cid).map(a => a.id);
    d.assignments = d.assignments.filter(a => a.classId !== cid);
    d.submissions = d.submissions.filter(s => !aids.includes(s.assignmentId));
    saveDb(d);
    return { ok: true };
  }

  if ((m = path.match(/^\/api\/classes\/(\d+)\/students$/)) && method === 'GET') {
    await mustTeacher(token);
    const cid = Number(m[1]);
    return d.enrollments.filter(e => e.classId === cid)
      .map(e => d.users.find(u => u.id === e.studentId)!)
      .filter(Boolean)
      .map(u => ({ id: u.id, studentNo: u.studentNo, name: u.name }))
      .sort((a, b) => (a.studentNo ?? '').localeCompare(b.studentNo ?? ''));
  }

  const addStudent = async (cid: number, no: string, name: string, password?: string): Promise<number> => {
    if (!no || !name) throw new MockError(400, '学号和姓名不能为空');
    const found = d.users.find(x => x.studentNo === no);
    const u: DbUser = found ?? await (async () => {
      const p = await hashPassword(password || no);
      const created: DbUser = { id: nextId(d), login: no, studentNo: no, name, passSalt: p.salt, passHash: p.hash, role: 'student' };
      d.users.push(created);
      return created;
    })();
    if (!d.enrollments.some(e => e.classId === cid && e.studentId === u.id))
      d.enrollments.push({ classId: cid, studentId: u.id });
    return u.id;
  };

  if ((m = path.match(/^\/api\/classes\/(\d+)\/students$/)) && method === 'POST') {
    await mustTeacher(token);
    const sid = await addStudent(Number(m[1]), String(body?.studentNo ?? '').trim(), String(body?.name ?? '').trim(),
      body?.password ? String(body.password) : undefined);
    saveDb(d);
    return { ok: true, studentId: sid };
  }

  if ((m = path.match(/^\/api\/classes\/(\d+)\/students\/(\d+)$/)) && method === 'DELETE') {
    await mustTeacher(token);
    d.enrollments = d.enrollments.filter(e => !(e.classId === Number(m![1]) && e.studentId === Number(m![2])));
    saveDb(d);
    return { ok: true };
  }

  if ((m = path.match(/^\/api\/classes\/(\d+)\/import$/)) && method === 'POST') {
    await mustTeacher(token);
    const cid = Number(m[1]);
    const rows = parseCsv(String(body?.csv ?? ''));
    let added = 0, skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [no, name, pw] = rows[i].map(s => s.trim());
      if (i === 0 && no.includes('学号')) continue;
      if (!no || !name) { errors.push(`第 ${i + 1} 行缺少学号或姓名`); skipped++; continue; }
      if (d.users.some(x => x.studentNo === no)) { skipped++; errors.push(`第 ${i + 1} 行 ${no}: 学号已存在,已跳过`); continue; }
      await addStudent(cid, no, name, pw || undefined);
      added++;
    }
    saveDb(d);
    return { added, skipped, errors };
  }

  if ((m = path.match(/^\/api\/students\/(\d+)\/reset-password$/)) && method === 'POST') {
    await mustTeacher(token);
    const u = d.users.find(x => x.id === Number(m![1]) && x.role === 'student');
    if (!u || !u.studentNo) throw new MockError(404, '学生不存在');
    const p = await hashPassword(u.studentNo);
    u.passSalt = p.salt; u.passHash = p.hash;
    saveDb(d);
    return { ok: true, password: u.studentNo };
  }

  // ---- 作业 ----
  if (path === '/api/assignments' && method === 'GET') {
    const classNameOf = (cid: number) => d.classes.find(c => c.id === cid)?.name ?? '';
    if (me.role === 'teacher') {
      return d.assignments.map(a => ({
        ...dtoA({ ...a, className: classNameOf(a.classId) }),
        total: d.enrollments.filter(e => e.classId === a.classId).length,
        submitted: d.submissions.filter(s => s.assignmentId === a.id).length,
        scored: d.submissions.filter(s => s.assignmentId === a.id && s.score != null).length,
      }));
    }
    return d.assignments
      .filter(a => d.enrollments.some(e => e.classId === a.classId && e.studentId === me.id))
      .map(a => ({ ...dtoA({ ...a, className: classNameOf(a.classId) }), my: mySub(d, me.id, a.id) }))
      .sort((x, y) => x.deadline - y.deadline);
  }

  if (path === '/api/assignments' && method === 'POST') {
    await mustTeacher(token);
    const classId = Number(body?.classId);
    if (!d.classes.some(c => c.id === classId)) throw new MockError(400, '班级不存在');
    const deadline = Number(body?.deadline);
    if (!Number.isFinite(deadline)) throw new MockError(400, '截止时间必须是数字');
    const allowLate = body?.allowLate ? 1 : 0;
    const lateDeadline = body?.allowLate ? Number(body?.lateDeadline) : null;
    if (allowLate === 1 && (lateDeadline == null || lateDeadline <= deadline)) throw new MockError(400, '允许补交时,补交截止必须晚于截止时间');
    const id = nextId(d);
    d.assignments.push({
      id, classId, title: String(body?.title ?? '').trim(), description: String(body?.description ?? ''),
      deadline, allowLate: allowLate as 0 | 1, lateDeadline, submitType: body?.submitType ?? 'both',
      version: 1, createdBy: me.id, createdAt: Date.now(),
    });
    saveDb(d);
    return { id };
  }

  if ((m = path.match(/^\/api\/assignments\/(\d+)$/))) {
    const aid = Number(m[1]);
    const a = d.assignments.find(x => x.id === aid);
    if (!a) throw new MockError(404, '作业不存在');
    const className = d.classes.find(c => c.id === a.classId)?.name ?? '';
    if (method === 'GET') return { ...dtoA({ ...a, className }), my: mySub(d, me.id, aid) };
    if (method === 'PUT') {
      await mustTeacher(token);
      const merged = { ...a, title: a.title, description: a.description, deadline: a.deadline, allowLate: a.allowLate, lateDeadline: a.lateDeadline, submitType: a.submitType, classId: a.classId };
      if (body?.classId !== undefined) {
        const cid = Number(body.classId);
        if (!d.classes.some(c => c.id === cid)) throw new MockError(400, '目标班级不存在');
        merged.classId = cid;
      }
      if (body?.title !== undefined) {
        if (!String(body.title).trim()) throw new MockError(400, '标题不能为空');
        merged.title = String(body.title).trim();
      }
      if (body?.description !== undefined) merged.description = String(body.description ?? '');
      if (body?.deadline !== undefined) merged.deadline = Number(body.deadline);
      if (body?.allowLate !== undefined) merged.allowLate = body.allowLate ? 1 : 0;
      if (body?.lateDeadline !== undefined) merged.lateDeadline = body.lateDeadline == null ? null : Number(body.lateDeadline);
      if (body?.submitType !== undefined) merged.submitType = body.submitType;
      if (merged.allowLate === 1 && (merged.lateDeadline == null || merged.lateDeadline <= merged.deadline))
        throw new MockError(400, '允许补交时,补交截止必须晚于截止时间');
      Object.assign(a, merged, { version: a.version + 1 });
      saveDb(d);
      return { ok: true, version: a.version };
    }
    if (method === 'DELETE') {
      await mustTeacher(token);
      d.assignments = d.assignments.filter(x => x.id !== aid);
      d.submissions = d.submissions.filter(s => s.assignmentId !== aid);
      d.history = d.history.filter(h => !d.submissions.some(s => s.id === h.submissionId));
      saveDb(d);
      return { ok: true };
    }
  }

  if ((m = path.match(/^\/api\/assignments\/(\d+)\/my$/)) && method === 'GET')
    return mySub(d, me.id, Number(m[1]));

  if ((m = path.match(/^\/api\/assignments\/(\d+)\/submit$/)) && method === 'POST') {
    if (me.role !== 'student') throw new MockError(403, '只有学生能提交作业');
    const aid = Number(m[1]);
    const a = d.assignments.find(x => x.id === aid);
    if (!a) throw new MockError(404, '作业不存在');
    if (!d.enrollments.some(e => e.classId === a.classId && e.studentId === me.id)) throw new MockError(403, '你不在此作业所属班级');
    const win = submitWindow({ deadline: a.deadline, allowLate: a.allowLate, lateDeadline: a.lateDeadline }, Date.now());
    if (win === 'closed') throw new MockError(403, '作业已截止,无法提交');
    const isLate = win === 'late' ? 1 : 0;
    const hasFile = typeof body?.fileB64 === 'string' && body.fileB64.length > 0;
    const hasText = typeof body?.content === 'string' && body.content.trim().length > 0;
    if (a.submitType === 'file' && !hasFile) throw new MockError(400, '本作业要求上传文件');
    if (a.submitType === 'text' && !hasText) throw new MockError(400, '本作业要求填写内容');
    if (a.submitType === 'both' && !hasFile && !hasText) throw new MockError(400, '请上传文件或填写内容');

    let fileKey: string | null = null, fileName: string | null = null, fileSize: number | null = null;
    let md5: string | null = null, sim: string | null = null;
    if (hasFile) {
      const bin = Uint8Array.from(atob(body.fileB64), c => c.charCodeAt(0));
      const buf = bin.buffer as ArrayBuffer;
      if (bin.length === 0) throw new MockError(400, '文件内容为空');
      if (bin.length > 8 * 1024 * 1024) throw new MockError(413, '文件超过 8MB 上限');
      fileName = String(body?.fileName ?? 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'file';
      const { createHashLike } = await import('./md5.ts');
      fileKey = `sub-${nextId(d)}`;
      await putFile(fileKey, buf);
      fileSize = bin.length;
      const text = new TextDecoder().decode(bin);
      if (!text.includes('\u0000')) sim = simhash(text).toString(16);
      md5 = createHashLike(text);
    }
    if (!sim && hasText) sim = simhash(body.content).toString(16);

    const old = d.submissions.find(x => x.assignmentId === aid && x.studentId === me.id);
    if (old) {
      d.history.push({ id: nextId(d), submissionId: old.id, content: old.content, fileName: old.fileName, submittedAt: old.submittedAt });
      void old.fileKey; // 旧文件覆盖键即可
    }
    const sid = old ? old.id : nextId(d);
    const sub: DbSubmission = {
      id: sid, assignmentId: aid, studentId: me.id,
      content: hasText ? body.content : null, fileName, fileKey, fileSize,
      submittedAt: Date.now(), isLate, attemptCount: old ? old.attemptCount + 1 : 1,
      score: null, comment: null, scoredAt: null, fileMd5: md5, fileSimhash: sim,
    };
    const idx = old ? d.submissions.indexOf(old) : -1;
    if (idx >= 0) d.submissions[idx] = sub; else d.submissions.push(sub);
    saveDb(d);
    return mySub(d, me.id, aid);
  }

  if ((m = path.match(/^\/api\/assignments\/(\d+)\/stats$/)) && method === 'GET') {
    await mustTeacher(token);
    const aid = Number(m[1]);
    const a = d.assignments.find(x => x.id === aid);
    if (!a) throw new MockError(404, '作业不存在');
    const className = d.classes.find(c => c.id === a.classId)?.name ?? '';
    const rows = d.enrollments.filter(e => e.classId === a.classId).map(e => {
      const u = d.users.find(x => x.id === e.studentId)!;
      const s = d.submissions.find(x => x.assignmentId === aid && x.studentId === e.studentId);
      return { u, s };
    });
    const onTime: any[] = [], late: any[] = [], missing: any[] = [];
    for (const { u, s } of rows) {
      if (!s) { missing.push({ studentId: u.id, studentNo: u.studentNo, name: u.name }); continue; }
      const item = {
        submissionId: s.id, studentId: u.id, studentNo: u.studentNo, name: u.name,
        submittedAt: s.submittedAt, isLate: s.isLate, attemptCount: s.attemptCount,
        fileName: s.fileName, content: s.content, score: s.score, comment: s.comment,
      };
      (s.isLate ? late : onTime).push(item);
    }
    const byMd5 = new Map<string, { studentNo: string; name: string; fileName: string | null }[]>();
    for (const { u, s } of rows) if (s?.fileMd5) {
      const member = { studentNo: u.studentNo ?? '', name: u.name, fileName: s.fileName };
      const arr = byMd5.get(s.fileMd5);
      if (arr) arr.push(member); else byMd5.set(s.fileMd5, [member]);
    }
    const duplicates = [...byMd5.entries()].filter(([, mm]) => mm.length > 1).map(([md5, members]) => ({ md5, members }));
    const withSim = rows.filter(({ s }) => s?.fileSimhash)
      .map(({ u, s }) => ({ studentNo: u.studentNo, name: u.name, fp: BigInt('0x' + s!.fileSimhash) }));
    const similar: any[] = [];
    for (let i = 0; i < withSim.length; i++)
      for (let j = i + 1; j < withSim.length; j++) {
        const dist = hamming(withSim[i].fp, withSim[j].fp);
        if (dist <= 4) similar.push({
          a: { studentNo: withSim[i].studentNo, name: withSim[i].name },
          b: { studentNo: withSim[j].studentNo, name: withSim[j].name },
          similarity: 1 - dist / 64,
        });
      }
    similar.sort((x, y) => y.similarity - x.similarity);
    return {
      assignment: dtoA({ ...a, className }), total: rows.length,
      onTime, late, missing, duplicates, similar,
    };
  }

  if ((m = path.match(/^\/api\/assignments\/(\d+)\/export$/)) && method === 'GET') {
    await mustTeacher(token);
    const stats = await handle(`/api/assignments/${m[1]}/stats`, 'GET', undefined, token);
    const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
    const rows: unknown[][] = [];
    for (const s of [...stats.onTime, ...stats.late])
      rows.push([s.studentNo, s.name, s.isLate ? '逾期已交' : '已交', fmt(s.submittedAt), s.attemptCount, s.fileName ?? '', s.score ?? '', s.comment ?? '']);
    for (const x of stats.missing) rows.push([x.studentNo, x.name, '未交', '', '', '', '', '']);
    return { __csv: toCsv(['学号', '姓名', '状态', '提交时间', '提交次数', '文件名', '分数', '评语'], rows), name: `${stats.assignment.title}-成绩单.csv` };
  }

  if ((m = path.match(/^\/api\/submissions\/(\d+)\/score$/)) && method === 'PUT') {
    await mustTeacher(token);
    const s = d.submissions.find(x => x.id === Number(m![1]));
    if (!s) throw new MockError(404, '提交记录不存在');
    s.score = body?.score == null ? null : Number(body.score);
    s.comment = body?.comment == null ? null : String(body.comment);
    s.scoredAt = s.score == null ? null : Date.now();
    saveDb(d);
    return { ok: true };
  }

  if ((m = path.match(/^\/api\/files\/(\d+)$/)) && method === 'GET') {
    const s = d.submissions.find(x => x.id === Number(m![1]));
    if (!s || !s.fileKey) throw new MockError(404, '文件不存在');
    if (me.role !== 'teacher' && me.id !== s.studentId) throw new MockError(403, '无权访问');
    const buf = await getFile(s.fileKey);
    if (!buf) throw new MockError(404, '文件已被清理');
    return { __file: buf, name: s.fileName ?? 'file' };
  }

  throw new MockError(404, `接口不存在: ${method} ${path}`);
}

/** api.ts 调用入口:init.token 携带登录态;返回 body,错误抛 MockError(status) */
export async function mockRequest<T = any>(path: string, init?: { method?: string; body?: unknown; token?: string }): Promise<T> {
  return await handle(path, init?.method ?? 'GET', init?.body, init?.token ?? '');
}
