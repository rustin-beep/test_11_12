/**
 * HTTP 服务:node:http 手写路由,零 npm 依赖。
 * - /api/*      JSON API(CORS 全开,前后端分离部署均可用)
 * - 其余 GET    托管 web/dist 静态产物(存在时;单机一键模式)
 * 所有时间判定以服务器时钟为准;每个响应带 X-Server-Time 供前端校准。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyPassword, hashPassword, signToken, verifyToken } from './auth.ts';
import { parseCsv, toCsv } from './util/csv.ts';
import { simhash, hamming } from './util/simhash.ts';
import { submitWindow } from '../shared/types.ts';
import type { SubmitType, User } from '../shared/types.ts';

const MAX_BODY = 16 * 1024 * 1024;        // JSON 上限(文件 base64 后)
const MAX_FILE = 8 * 1024 * 1024;         // 单文件 8MB
const TEXT_EXT = new Set(['.txt', '.md', '.c', '.h', '.cpp', '.hpp', '.java', '.py', '.js', '.ts', '.html', '.css', '.json', '.xml', '.sql', '.sh', '.bat', '.csv']);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface Ctx { db: DatabaseSync; uploadDir: string; staticDir: string | null }

// ---------- 基础设施 ----------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data); // 先序列化:失败时尚未写头,错误响应可正常送达
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Server-Time': String(Date.now()),
    ...corsHeaders(),
  });
  res.end(body);
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '请求体过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<any> {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw new HttpError(400, 'JSON 格式错误'); }
}

function getAuth(ctx: Ctx, req: IncomingMessage): User | null {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  return ctx.db.prepare('SELECT id, login, student_no AS studentNo, name, role FROM users WHERE id=?').get(payload.uid) as User | undefined ?? null;
}

function requireAuth(ctx: Ctx, req: IncomingMessage): User {
  const u = getAuth(ctx, req);
  if (!u) throw new HttpError(401, '未登录或登录已过期');
  return u;
}

function requireTeacher(ctx: Ctx, req: IncomingMessage): User {
  const u = requireAuth(ctx, req);
  if (u.role !== 'teacher') throw new HttpError(403, '需要教师权限');
  return u;
}

function int(s: string): number { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, '非法 ID'); return n; }

function requireNum(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${name} 必须是数字`);
  return v;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'file';
}

// ---------- 作业相关逻辑 ----------

function validateAssignmentBody(body: any, partial = false) {
  const out: any = {};
  if (body.classId !== undefined) out.class_id = requireNum(body.classId, '班级');
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, '标题不能为空');
    out.title = body.title.trim();
  }
  if (body.description !== undefined) out.description = String(body.description ?? '');
  if (!partial || body.deadline !== undefined) out.deadline = requireNum(body.deadline, '截止时间');
  if (body.allowLate !== undefined) out.allow_late = body.allowLate ? 1 : 0;
  if (body.lateDeadline !== undefined) out.late_deadline = body.lateDeadline == null ? null : requireNum(body.lateDeadline, '补交截止');
  if (body.submitType !== undefined) {
    if (!['file', 'text', 'both'].includes(body.submitType)) throw new HttpError(400, '提交类型非法');
    out.submit_type = body.submitType as SubmitType;
  }
  return out;
}

function checkLateRule(allowLate: number, lateDeadline: number | null, deadline: number) {
  if (allowLate === 1 && (lateDeadline == null || lateDeadline <= deadline))
    throw new HttpError(400, '允许补交时,补交截止必须晚于截止时间');
}

function getAssignment(ctx: Ctx, id: number) {
  const a = ctx.db.prepare(`
    SELECT a.*, c.name AS className FROM assignments a JOIN classes c ON c.id=a.class_id WHERE a.id=?`).get(id) as any;
  if (!a) throw new HttpError(404, '作业不存在');
  return a;
}

function toAssignmentDto(a: any) {
  return {
    id: a.id, classId: a.class_id, className: a.className, title: a.title, description: a.description,
    deadline: a.deadline, allowLate: a.allow_late, lateDeadline: a.late_deadline,
    submitType: a.submit_type, version: a.version, createdAt: a.created_at,
  };
}

function mySubmission(ctx: Ctx, studentId: number, assignmentId: number) {
  const s = ctx.db.prepare(`
    SELECT id, submitted_at AS submittedAt, is_late AS isLate, attempt_count AS attemptCount,
           file_name AS fileName, content, score, comment, scored_at AS scoredAt
    FROM submissions WHERE assignment_id=? AND student_id=?`).get(assignmentId, studentId) as any;
  if (s) {
    s.history = ctx.db.prepare(
      'SELECT content, file_name AS fileName, submitted_at AS submittedAt FROM submission_history WHERE submission_id=? ORDER BY submitted_at DESC'
    ).all(s.id);
  }
  return s ?? null;
}

/** 提交:窗口判定(服务器时钟权威)+ 落盘 + 指纹 + upsert 防重复 */
function handleSubmit(ctx: Ctx, user: User, assignmentId: number, body: any) {
  const a = getAssignment(ctx, assignmentId);
  if (!ctx.db.prepare('SELECT 1 FROM enrollments WHERE class_id=? AND student_id=?').get(a.class_id, user.id))
    throw new HttpError(403, '你不在此作业所属班级');

  // a 是数据库行(snake_case),submitWindow 使用 DTO 字段名(与前端一致)
  const state = submitWindow(
    { deadline: a.deadline, allowLate: a.allow_late, lateDeadline: a.late_deadline },
    Date.now(),
  );
  if (state === 'closed') throw new HttpError(403, '作业已截止,无法提交');
  const isLate = state === 'late' ? 1 : 0;

  const type = a.submit_type as string;
  const hasFile = typeof body.fileB64 === 'string' && body.fileB64.length > 0;
  const hasText = typeof body.content === 'string' && body.content.trim().length > 0;
  if (type === 'file' && !hasFile) throw new HttpError(400, '本作业要求上传文件');
  if (type === 'text' && !hasText) throw new HttpError(400, '本作业要求填写内容');
  if (type === 'both' && !hasFile && !hasText) throw new HttpError(400, '请上传文件或填写内容');

  let filePath: string | null = null, fileName: string | null = null, fileSize: number | null = null;
  let md5: string | null = null, sim: string | null = null;

  if (hasFile) {
    const buf = Buffer.from(body.fileB64, 'base64');
    if (buf.length === 0) throw new HttpError(400, '文件内容为空');
    if (buf.length > MAX_FILE) throw new HttpError(413, '文件超过 8MB 上限');
    fileName = safeFileName(String(body.fileName ?? 'file'));
    md5 = createHash('md5').update(buf).digest('hex');
    const dir = join(ctx.uploadDir, String(assignmentId));
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, `${user.studentNo}_${Date.now()}_${fileName}`);
    writeFileSync(filePath, buf);
    fileSize = buf.length;
    // 文本类文件算 simhash(查重);含 \0 视为二进制
    const text = buf.toString('utf8');
    if (!text.includes('\u0000') && TEXT_EXT.has(extname(fileName).toLowerCase())) sim = simhash(text).toString(16);
  }
  if (!sim && hasText) sim = simhash(body.content).toString(16);

  // 覆盖提交:旧内容进历史,attempt_count+1,重新批阅(清空旧分数)
  const old = ctx.db.prepare('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?').get(assignmentId, user.id) as any;
  if (old) {
    ctx.db.prepare('INSERT INTO submission_history (submission_id, content, file_path, file_name, submitted_at) VALUES (?,?,?,?,?)')
      .run(old.id, old.content, old.file_path, old.file_name, old.submitted_at);
  }
  ctx.db.prepare(`
    INSERT INTO submissions (assignment_id, student_id, content, file_path, file_name, file_size, submitted_at, is_late, attempt_count, file_md5, file_simhash)
    VALUES (?,?,?,?,?,?,?,?,1,?,?)
    ON CONFLICT(assignment_id, student_id) DO UPDATE SET
      content=excluded.content, file_path=excluded.file_path, file_name=excluded.file_name,
      file_size=excluded.file_size, submitted_at=excluded.submitted_at, is_late=excluded.is_late,
      attempt_count=submissions.attempt_count+1, score=NULL, comment=NULL, scored_at=NULL,
      file_md5=excluded.file_md5, file_simhash=excluded.file_simhash
  `).run(assignmentId, user.id, hasText ? body.content : null, filePath, fileName, fileSize, Date.now(), isLate, md5, sim);

  return mySubmission(ctx, user.id, assignmentId);
}

function assignmentStats(ctx: Ctx, assignmentId: number) {
  const a = getAssignment(ctx, assignmentId);
  const rows = ctx.db.prepare(`
    SELECT u.id AS studentId, u.student_no AS studentNo, u.name,
           s.id AS submissionId, s.submitted_at AS submittedAt, s.is_late AS isLate,
           s.attempt_count AS attemptCount, s.file_name AS fileName, s.content,
           s.score, s.comment, s.file_md5 AS fileMd5, s.file_simhash AS fileSimhash
    FROM enrollments e
    JOIN users u ON u.id = e.student_id
    LEFT JOIN submissions s ON s.student_id = u.id AND s.assignment_id = ?
    WHERE e.class_id = ?
    ORDER BY (s.id IS NULL) DESC, u.student_no
  `).all(assignmentId, a.class_id) as any[];

  const onTime: any[] = [], late: any[] = [], missing: any[] = [];
  for (const r of rows) {
    if (!r.submissionId) { missing.push({ studentId: r.studentId, studentNo: r.studentNo, name: r.name }); continue; }
    const item = {
      submissionId: r.submissionId, studentId: r.studentId, studentNo: r.studentNo, name: r.name,
      submittedAt: r.submittedAt, isLate: r.isLate, attemptCount: r.attemptCount,
      fileName: r.fileName, content: r.content, score: r.score, comment: r.comment,
    };
    (r.isLate ? late : onTime).push(item);
  }

  // 查重①:MD5 完全相同分组
  const byMd5 = new Map<string, { studentNo: string; name: string; fileName: string | null }[]>();
  for (const r of rows) if (r.fileMd5) {
    if (!byMd5.has(r.fileMd5)) byMd5.set(r.fileMd5, []);
    byMd5.get(r.fileMd5)!.push({ studentNo: r.studentNo, name: r.name, fileName: r.fileName });
  }
  const duplicates = [...byMd5.entries()].filter(([, mm]) => mm.length > 1).map(([md5, members]) => ({ md5, members }));

  // 查重②:simhash 海明距离 ≤ 4 的相似对
  const withSim = rows.filter(r => r.fileSimhash).map(r => ({ studentNo: r.studentNo, name: r.name, fp: BigInt('0x' + r.fileSimhash) }));
  const similar: { a: any; b: any; similarity: number }[] = [];
  for (let i = 0; i < withSim.length; i++)
    for (let j = i + 1; j < withSim.length; j++) {
      const d = hamming(withSim[i].fp, withSim[j].fp);
      if (d <= 4) similar.push({
        a: { studentNo: withSim[i].studentNo, name: withSim[i].name },   // 不带 BigInt,否则 JSON 序列化失败
        b: { studentNo: withSim[j].studentNo, name: withSim[j].name },
        similarity: 1 - d / 64,
      });
    }
  similar.sort((x, y) => y.similarity - x.similarity);

  return { assignment: toAssignmentDto(a), total: rows.length, onTime, late, missing, duplicates, similar };
}

function addStudent(ctx: Ctx, classId: number, no: string, name: string, password?: string): number {
  if (!no || !name) throw new HttpError(400, '学号和姓名不能为空');
  let u = ctx.db.prepare('SELECT * FROM users WHERE student_no=?').get(no) as any;
  if (!u) {
    try {
      const info = ctx.db.prepare(
        'INSERT INTO users (login, student_no, name, password_hash, role) VALUES (?,?,?,?,?)'
      ).run(no, no, name, hashPassword(password || no), 'student');
      u = { id: Number(info.lastInsertRowid) };
    } catch { throw new HttpError(409, `登录名 ${no} 已被占用`); }
  }
  ctx.db.prepare('INSERT OR IGNORE INTO enrollments (class_id, student_id) VALUES (?,?)').run(classId, u.id);
  return u.id;
}

// ---------- 路由 ----------

async function route(ctx: Ctx, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }
  if (!p.startsWith('/api/')) { serveStatic(ctx, url, res); return; }

  // ---- 公开:登录 ----
  if (p === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const u = ctx.db.prepare('SELECT * FROM users WHERE login=?').get(String(body.login ?? '')) as any;
    if (!u || !verifyPassword(String(body.password ?? ''), u.password_hash))
      throw new HttpError(401, '用户名或密码错误');
    send(res, 200, {
      token: signToken(u.id, u.role),
      user: { id: u.id, login: u.login, studentNo: u.student_no, name: u.name, role: u.role },
    });
    return;
  }

  const me = requireAuth(ctx, req);

  if (p === '/api/me' && method === 'GET') { send(res, 200, me); return; }

  if (p === '/api/change-password' && method === 'POST') {
    const body = await readJson(req);
    const u = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(me.id) as any;
    if (!verifyPassword(String(body.oldPassword ?? ''), u.password_hash)) throw new HttpError(400, '原密码错误');
    const nw = String(body.newPassword ?? '');
    if (nw.length < 4) throw new HttpError(400, '新密码至少 4 位');
    ctx.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(nw), me.id);
    send(res, 200, { ok: true });
    return;
  }

  // ---- 班级管理(教师,多班) ----
  if (p === '/api/classes') {
    if (method === 'GET') {
      requireTeacher(ctx, req);
      send(res, 200, ctx.db.prepare(`
        SELECT c.id, c.name, COUNT(e.student_id) AS studentCount
        FROM classes c LEFT JOIN enrollments e ON e.class_id=c.id
        GROUP BY c.id ORDER BY c.created_at`).all());
      return;
    }
    if (method === 'POST') {
      requireTeacher(ctx, req);
      const body = await readJson(req);
      const name = String(body.name ?? '').trim();
      if (!name) throw new HttpError(400, '班级名不能为空');
      try { ctx.db.prepare('INSERT INTO classes (name, created_at) VALUES (?,?)').run(name, Date.now()); }
      catch { throw new HttpError(409, '班级已存在'); }
      send(res, 200, { ok: true });
      return;
    }
  }

  let m: RegExpMatchArray | null;

  if ((m = p.match(/^\/api\/classes\/(\d+)$/)) && method === 'DELETE') {
    requireTeacher(ctx, req);
    ctx.db.prepare('DELETE FROM classes WHERE id=?').run(int(m[1]));
    send(res, 200, { ok: true }); return;
  }

  if ((m = p.match(/^\/api\/classes\/(\d+)\/students$/)) && method === 'GET') {
    requireTeacher(ctx, req);
    send(res, 200, ctx.db.prepare(`
      SELECT u.id, u.student_no AS studentNo, u.name FROM enrollments e
      JOIN users u ON u.id=e.student_id WHERE e.class_id=? ORDER BY u.student_no`).all(int(m[1])));
    return;
  }
  if ((m = p.match(/^\/api\/classes\/(\d+)\/students$/)) && method === 'POST') {
    requireTeacher(ctx, req);
    const body = await readJson(req);
    const sid = addStudent(ctx, int(m[1]), String(body.studentNo ?? '').trim(), String(body.name ?? '').trim(), body.password ? String(body.password) : undefined);
    send(res, 200, { ok: true, studentId: sid }); return;
  }
  if ((m = p.match(/^\/api\/classes\/(\d+)\/students\/(\d+)$/)) && method === 'DELETE') {
    requireTeacher(ctx, req);
    ctx.db.prepare('DELETE FROM enrollments WHERE class_id=? AND student_id=?').run(int(m[1]), int(m[2]));
    send(res, 200, { ok: true }); return;
  }
  if ((m = p.match(/^\/api\/classes\/(\d+)\/import$/)) && method === 'POST') {
    requireTeacher(ctx, req);
    const body = await readJson(req);
    const rows = parseCsv(String(body.csv ?? ''));
    const classId = int(m[1]);
    let added = 0, skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [no, name, pw] = rows[i].map(s => s.trim());
      if (i === 0 && no.includes('学号')) continue; // 表头行
      if (!no || !name) { errors.push(`第 ${i + 1} 行缺少学号或姓名`); skipped++; continue; }
      if (ctx.db.prepare('SELECT 1 FROM users WHERE student_no=?').get(no)) {
        skipped++; errors.push(`第 ${i + 1} 行 ${no}: 学号已存在,已跳过`);
        continue;
      }
      try { addStudent(ctx, classId, no, name, pw || undefined); added++; }
      catch (e) { skipped++; errors.push(`第 ${i + 1} 行 ${no}: ${(e as Error).message}`); }
    }
    send(res, 200, { added, skipped, errors }); return;
  }

  // ---- 作业 ----
  if (p === '/api/assignments' && method === 'GET') {
    if (me.role === 'teacher') {
      const rows = ctx.db.prepare(`
        SELECT a.*, c.name AS className,
          (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=a.class_id) AS total,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id) AS submitted,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id AND s.score IS NOT NULL) AS scored
        FROM assignments a JOIN classes c ON c.id=a.class_id
        ORDER BY a.created_at DESC`).all() as any[];
      send(res, 200, rows.map(r => ({ ...toAssignmentDto(r), total: r.total, submitted: r.submitted, scored: r.scored })));
      return;
    }
    const rows = ctx.db.prepare(`
      SELECT a.*, c.name AS className, s.id AS sid, s.submitted_at, s.is_late, s.attempt_count,
             s.file_name, s.content, s.score, s.comment, s.scored_at
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      JOIN enrollments e ON e.class_id = c.id AND e.student_id = ?
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      ORDER BY a.deadline ASC`).all(me.id, me.id) as any[];
    send(res, 200, rows.map(r => ({
      ...toAssignmentDto(r),
      my: r.sid ? {
        id: r.sid, submittedAt: r.submitted_at, isLate: r.is_late, attemptCount: r.attempt_count,
        fileName: r.file_name, content: r.content, score: r.score, comment: r.comment, scoredAt: r.scored_at,
      } : null,
    })));
    return;
  }

  if (p === '/api/assignments' && method === 'POST') {
    requireTeacher(ctx, req);
    const body = await readJson(req);
    const v = validateAssignmentBody(body);
    const classId = requireNum(body.classId, '班级');
    if (!ctx.db.prepare('SELECT 1 FROM classes WHERE id=?').get(classId)) throw new HttpError(400, '班级不存在');
    checkLateRule(v.allow_late ?? 0, v.late_deadline ?? null, v.deadline);
    const info = ctx.db.prepare(`
      INSERT INTO assignments (class_id, title, description, deadline, allow_late, late_deadline, submit_type, version, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,1,?,?)`)
      .run(classId, v.title, v.description ?? '', v.deadline, v.allow_late ?? 0, v.late_deadline ?? null, v.submit_type ?? 'both', me.id, Date.now());
    send(res, 200, { id: Number(info.lastInsertRowid) });
    return;
  }

  if ((m = p.match(/^\/api\/assignments\/(\d+)$/))) {
    const id = int(m[1]);
    if (method === 'PUT') {
      requireTeacher(ctx, req);
      const a = getAssignment(ctx, id);
      const v = validateAssignmentBody(await readJson(req), true);
      if (v.class_id !== undefined && !ctx.db.prepare('SELECT 1 FROM classes WHERE id=?').get(v.class_id))
        throw new HttpError(400, '目标班级不存在');
      const merged = { ...a, ...v };
      checkLateRule(merged.allow_late, merged.late_deadline, merged.deadline);
      // 任何修改都 version+1;学生端轮询发现版本变化即刷新(教师延长截止 → 逾期作业复活)
      ctx.db.prepare(`
        UPDATE assignments SET class_id=?, title=?, description=?, deadline=?, allow_late=?, late_deadline=?, submit_type=?, version=version+1 WHERE id=?`)
        .run(merged.class_id, merged.title, merged.description, merged.deadline, merged.allow_late, merged.late_deadline, merged.submit_type, id);
      send(res, 200, { ok: true, version: a.version + 1 }); return;
    }
    if (method === 'DELETE') {
      requireTeacher(ctx, req);
      ctx.db.prepare('DELETE FROM assignments WHERE id=?').run(id);
      send(res, 200, { ok: true }); return;
    }
    if (method === 'GET') {
      const a = getAssignment(ctx, id);
      send(res, 200, { ...toAssignmentDto(a), my: mySubmission(ctx, me.id, id) });
      return;
    }
  }

  if ((m = p.match(/^\/api\/assignments\/(\d+)\/my$/)) && method === 'GET') {
    send(res, 200, mySubmission(ctx, me.id, int(m[1])));
    return;
  }

  if ((m = p.match(/^\/api\/assignments\/(\d+)\/submit$/)) && method === 'POST') {
    if (me.role !== 'student') throw new HttpError(403, '只有学生能提交作业');
    send(res, 200, handleSubmit(ctx, me, int(m[1]), await readJson(req)));
    return;
  }

  if ((m = p.match(/^\/api\/assignments\/(\d+)\/stats$/)) && method === 'GET') {
    requireTeacher(ctx, req);
    send(res, 200, assignmentStats(ctx, int(m[1])));
    return;
  }

  if ((m = p.match(/^\/api\/assignments\/(\d+)\/export$/)) && method === 'GET') {
    requireTeacher(ctx, req);
    const stats = assignmentStats(ctx, int(m[1]));
    const fmt = (ts: number | null) => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
    const rows: unknown[][] = [];
    for (const s of stats.onTime)
      rows.push([s.studentNo, s.name, '已交', fmt(s.submittedAt), s.attemptCount, s.fileName ?? '', s.score ?? '', s.comment ?? '']);
    for (const s of stats.late)
      rows.push([s.studentNo, s.name, '逾期已交', fmt(s.submittedAt), s.attemptCount, s.fileName ?? '', s.score ?? '', s.comment ?? '']);
    for (const x of stats.missing)
      rows.push([x.studentNo, x.name, '未交', '', '', '', '', '']);
    const csv = toCsv(['学号', '姓名', '状态', '提交时间', '提交次数', '文件名', '分数', '评语'], rows);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(stats.assignment.title + '-成绩单.csv')}`,
      ...corsHeaders(),
    });
    res.end(csv);
    return;
  }

  if ((m = p.match(/^\/api\/students\/(\d+)\/reset-password$/)) && method === 'POST') {
    requireTeacher(ctx, req);
    const u = ctx.db.prepare(`SELECT * FROM users WHERE id=? AND role='student'`).get(int(m[1])) as any;
    if (!u || !u.student_no) throw new HttpError(404, '学生不存在');
    ctx.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(u.student_no), u.id);
    send(res, 200, { ok: true, password: u.student_no }); return;
  }

  if ((m = p.match(/^\/api\/submissions\/(\d+)\/score$/)) && method === 'PUT') {
    requireTeacher(ctx, req);
    const body = await readJson(req);
    const score = body.score == null ? null : requireNum(body.score, '分数');
    ctx.db.prepare('UPDATE submissions SET score=?, comment=?, scored_at=? WHERE id=?')
      .run(score, body.comment == null ? null : String(body.comment), score == null ? null : Date.now(), int(m[1]));
    send(res, 200, { ok: true });
    return;
  }

  if ((m = p.match(/^\/api\/files\/(\d+)$/)) && method === 'GET') {
    const s = ctx.db.prepare('SELECT * FROM submissions WHERE id=?').get(int(m[1])) as any;
    if (!s || !s.file_path) throw new HttpError(404, '文件不存在');
    if (me.role !== 'teacher' && me.id !== s.student_id) throw new HttpError(403, '无权访问');
    if (!existsSync(s.file_path)) throw new HttpError(404, '文件已被清理');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.file_name ?? 'file')}`,
      ...corsHeaders(),
    });
    res.end(readFileSync(s.file_path));
    return;
  }

  throw new HttpError(404, `接口不存在: ${method} ${p}`);
}

// ---------- 静态托管(单机模式;分离部署时 dist 不存在则仅提供 API) ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function serveStatic(ctx: Ctx, url: URL, res: ServerResponse) {
  if (!ctx.staticDir) { send(res, 404, { error: '前端未构建,仅 API 模式' }); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const abs = normalize(join(ctx.staticDir, rel));
  if (!abs.startsWith(normalize(ctx.staticDir))) { res.writeHead(403); res.end(); return; }
  if (existsSync(abs) && statSync(abs).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream', ...corsHeaders() });
    res.end(readFileSync(abs));
    return;
  }
  const index = join(ctx.staticDir, 'index.html');
  if (existsSync(index)) {
    res.writeHead(200, { 'Content-Type': MIME['.html'], ...corsHeaders() });
    res.end(readFileSync(index));
    return;
  }
  send(res, 404, { error: '前端未构建' });
}

// ---------- 启动 ----------

export function startServer(opts: { db: DatabaseSync; uploadDir: string; staticDir?: string | null; port?: number; host?: string }) {
  const staticDefault = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  const ctx: Ctx = {
    db: opts.db,
    uploadDir: opts.uploadDir,
    staticDir: opts.staticDir !== undefined ? opts.staticDir : (existsSync(staticDefault) ? staticDefault : null),
  };
  const server = createServer((req, res) => {
    route(ctx, req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) send(res, status, { error: e.message ?? '服务器错误' });
      else res.end();
    });
  });
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(opts.port ?? 0, opts.host ?? '0.0.0.0', () => {
      const addr = server.address()!;
      resolve({ server, port: typeof addr === 'object' ? addr.port : opts.port! });
    });
  });
}
