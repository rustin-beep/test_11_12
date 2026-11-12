/**
 * API 集成测试:启动真实 HTTP 服务(:memory: 数据库 + 临时上传目录)
 * 覆盖:登录鉴权 / 多班名单 / 逾期提交 / 补交 / 并发重复提交 / 覆盖重交 /
 *       修改截止(version++) / 统计缺交 / 批阅 / 查重 / CSV 导出
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, seedTeacher } from '../server/db.ts';
import { startServer } from '../server/server.ts';
import { setSecret } from '../server/auth.ts';

let base = '';
let tmpDir = '';
let serverHandle: Awaited<ReturnType<typeof startServer>>;

const tokens: Record<string, string> = {};

async function req(method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(base + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const j = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

before(async () => {
  setSecret('test-secret');
  tmpDir = mkdtempSync(join(tmpdir(), 'hw-test-'));
  const db = openDb(':memory:');
  seedTeacher(db); // 默认教师 teacher/123456
  serverHandle = await startServer({
    db,
    uploadDir: join(tmpDir, 'uploads'),
    staticDir: null,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${serverHandle.port}`;
});

after(() => {
  serverHandle.server.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test('登录:错误密码 401 / 教师 200', async () => {
  assert.equal((await req('POST', '/api/login', { login: 'teacher', password: 'wrong' })).status, 401);
  const r = await req('POST', '/api/login', { login: 'teacher', password: '123456' });
  assert.equal(r.status, 200);
  tokens.teacher = (await j(r)).token;
});

test('鉴权:无 token 401,学生不能访问班级管理', async () => {
  assert.equal((await req('GET', '/api/me')).status, 401);
  assert.equal((await req('GET', '/api/classes', undefined, 'bad-token')).status, 401);
});

test('建两个班(多班)并 CSV 导入学生', async () => {
  assert.equal((await req('POST', '/api/classes', { name: '计科2301' }, tokens.teacher)).status, 200);
  assert.equal((await req('POST', '/api/classes', { name: '软工2302' }, tokens.teacher)).status, 200);
  assert.equal((await req('POST', '/api/classes', { name: '计科2301' }, tokens.teacher)).status, 409); // 重名
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  assert.equal(classes.length, 2);
  const c1 = classes[0].id;

  const r = await req('POST', `/api/classes/${c1}/import`, {
    csv: '学号,姓名\nS001,张三\nS002,李四\nS003,王五\nS001,张三\n,坏行\n',
  }, tokens.teacher);
  const body = await j(r);
  assert.equal(body.added, 3);
  assert.equal(body.skipped, 2); // 重复 S001 + 空学号行

  // 学生登录(初始密码=学号),只能看到自己班
  for (const no of ['S001', 'S002', 'S003']) {
    const lr = await req('POST', '/api/login', { login: no, password: no });
    assert.equal(lr.status, 200, no + ' 应能登录');
    tokens[no] = (await j(lr)).token;
  }
  // 学生不能访问班级管理
  assert.equal((await req('GET', '/api/classes', undefined, tokens.S001)).status, 403);
});

test('发布作业 / 学生提交 / 覆盖重交(attempt+1)', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const ar = await req('POST', '/api/assignments', {
    classId: c1, title: '第一次作业', description: '写一段自我介绍',
    deadline: Date.now() + 3600_000, allowLate: false, submitType: 'both',
  }, tokens.teacher);
  const { id: aid } = await j(ar);
  assert.ok(aid > 0);

  // 未在名单的教师班外提交被拒:软工班学生看不到此作业
  const r2 = await req('POST', '/api/assignments', {
    classId: classes[1].id, title: '软工作业', deadline: Date.now() + 3600_000, submitType: 'text',
  }, tokens.teacher);
  const aid2 = (await j(r2)).id;

  // S001 第一次提交
  let my = await j(await req('POST', `/api/assignments/${aid}/submit`, { content: '我叫张三' }, tokens.S001));
  assert.equal(my.attemptCount, 1);
  // 覆盖重交
  my = await j(await req('POST', `/api/assignments/${aid}/submit`, { content: '我叫张三(修改版)' }, tokens.S001));
  assert.equal(my.attemptCount, 2);
  assert.equal(my.history.length, 1); // 旧版本进了历史
});

test('逾期:已截止提交 403 / 补交窗口内可交且标记逾期 / 超补交截止 403', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const mk = async (deadline: number, allowLate: boolean, lateDeadline: number | null) =>
    (await j(await req('POST', '/api/assignments', { classId: c1, title: 't', deadline, allowLate, lateDeadline, submitType: 'text' }, tokens.teacher))).id;

  const closed = await mk(Date.now() - 3600_000, false, null);
  assert.equal((await req('POST', `/api/assignments/${closed}/submit`, { content: 'x' }, tokens.S001)).status, 403);

  const late = await mk(Date.now() - 3600_000, true, Date.now() + 3600_000);
  const my = await j(await req('POST', `/api/assignments/${late}/submit`, { content: '补交' }, tokens.S001));
  assert.equal(my.isLate, 1);

  const lateOver = await mk(Date.now() - 7200_000, true, Date.now() - 3600_000);
  assert.equal((await req('POST', `/api/assignments/${lateOver}/submit`, { content: 'x' }, tokens.S001)).status, 403);
});

test('并发重复提交:同时发两个请求,库里只有一条记录', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: classes[0].id, title: '并发测试', deadline: Date.now() + 3600_000, submitType: 'text',
  }, tokens.teacher))).id;

  const [r1, r2] = await Promise.all([
    req('POST', `/api/assignments/${aid}/submit`, { content: 'A' }, tokens.S002),
    req('POST', `/api/assignments/${aid}/submit`, { content: 'B' }, tokens.S002),
  ]);
  assert.ok(r1.ok && r2.ok);
  // 无论顺序如何,S002 在统计中只出现一次(UNIQUE 约束兜底)
  const stats = await j(await req('GET', `/api/assignments/${aid}/stats`, undefined, tokens.teacher));
  assert.equal(stats.onTime.filter((s: any) => s.studentNo === 'S002').length, 1);
});

test('统计:未交名单准确 / 批阅打分学生可见', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: c1, title: '统计测试', deadline: Date.now() + 3600_000, submitType: 'text',
  }, tokens.teacher))).id;
  // S001 交,S003 不交
  await req('POST', `/api/assignments/${aid}/submit`, { content: '交了' }, tokens.S001);

  let stats = await j(await req('GET', `/api/assignments/${aid}/stats`, undefined, tokens.teacher));
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.missing.map((x: any) => x.studentNo), ['S002', 'S003']);
  assert.equal(stats.onTime.length, 1);

  // 批阅
  const sid = stats.onTime[0].submissionId;
  assert.equal((await req('PUT', `/api/submissions/${sid}/score`, { score: 88, comment: '写得好' }, tokens.teacher)).status, 200);
  stats = await j(await req('GET', `/api/assignments/${aid}/stats`, undefined, tokens.teacher));
  assert.equal(stats.onTime[0].score, 88);

  // 学生端可见成绩
  const list = await j(await req('GET', '/api/assignments', undefined, tokens.S001));
  const mine = list.find((a: any) => a.id === aid);
  assert.equal(mine.my.score, 88);
  assert.equal(mine.my.comment, '写得好');

  // 学生不能看统计
  assert.equal((await req('GET', `/api/assignments/${aid}/stats`, undefined, tokens.S001)).status, 403);
});

test('教师修改截止时间:version+1,逾期作业复活', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: c1, title: '复活测试', deadline: Date.now() - 1000, submitType: 'text',
  }, tokens.teacher))).id;
  assert.equal((await req('POST', `/api/assignments/${aid}/submit`, { content: 'x' }, tokens.S001)).status, 403);

  // 延长到 1 小时后
  await req('PUT', `/api/assignments/${aid}`, { deadline: Date.now() + 3600_000 }, tokens.teacher);
  const list = await j(await req('GET', '/api/assignments', undefined, tokens.S001));
  const a = list.find((x: any) => x.id === aid);
  assert.equal(a.version, 2); // 学生端轮询感知
  assert.equal((await req('POST', `/api/assignments/${aid}/submit`, { content: '复活后提交' }, tokens.S001)).status, 200);
});

test('文件提交与查重:相同文件被分组', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: c1, title: '文件查重', deadline: Date.now() + 3600_000, submitType: 'file',
  }, tokens.teacher))).id;

  const b64 = Buffer.from('#include <stdio.h>\nint main(){printf("hello");}\n').toString('base64');
  await req('POST', `/api/assignments/${aid}/submit`, { fileName: 'a.c', fileB64: b64 }, tokens.S001);
  await req('POST', `/api/assignments/${aid}/submit`, { fileName: 'b.c', fileB64: b64 }, tokens.S002);

  const stats = await j(await req('GET', `/api/assignments/${aid}/stats`, undefined, tokens.teacher));
  assert.equal(stats.duplicates.length, 1);
  assert.equal(stats.duplicates[0].members.length, 2);

  // 教师下载提交的文件
  const sid = stats.onTime[0].submissionId;
  const fr = await req('GET', `/api/files/${sid}`, undefined, tokens.teacher);
  assert.equal(fr.status, 200);
  // 学生不能下载别人的
  const other = stats.onTime.find((s: any) => s.studentNo !== 'S001');
  assert.equal((await req('GET', `/api/files/${other.submissionId}`, undefined, tokens.S001)).status, 403);
  // 自己可以
  const own = stats.onTime.find((s: any) => s.studentNo === 'S001');
  assert.equal((await req('GET', `/api/files/${own.submissionId}`, undefined, tokens.S001)).status, 200);
});

test('导出 CSV:带 BOM,含未交学生', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const c1 = classes[0].id;
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: c1, title: '导出测试', deadline: Date.now() + 3600_000, submitType: 'text',
  }, tokens.teacher))).id;
  await req('POST', `/api/assignments/${aid}/submit`, { content: 'x' }, tokens.S001);

  const r = await req('GET', `/api/assignments/${aid}/export`, undefined, tokens.teacher);
  // 注意:fetch().text() 会剥掉 UTF-8 BOM,必须检查原始字节
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV 应以 UTF-8 BOM 开头(Excel 兼容)');
  const text = buf.slice(3).toString('utf8');
  assert.ok(text.includes('未交'));
  assert.ok(text.includes('S003'));
});

test('改密码与新密码登录', async () => {
  assert.equal((await req('POST', '/api/change-password', { oldPassword: 'nope', newPassword: 'abcd' }, tokens.S003)).status, 400);
  assert.equal((await req('POST', '/api/change-password', { oldPassword: 'S003', newPassword: 'newpw1' }, tokens.S003)).status, 200);
  const lr = await req('POST', '/api/login', { login: 'S003', password: 'newpw1' });
  assert.equal(lr.status, 200);
});

test('文件超限被拒(>8MB)', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: classes[0].id, title: '超限测试', deadline: Date.now() + 3600_000, submitType: 'file',
  }, tokens.teacher))).id;
  const big = Buffer.alloc(8 * 1024 * 1024 + 100).toString('base64');
  assert.equal((await req('POST', `/api/assignments/${aid}/submit`, { fileName: 'big.bin', fileB64: big }, tokens.S001)).status, 413);
});

test('编辑作业可以换班级', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const aid = (await j(await req('POST', '/api/assignments', {
    classId: classes[0].id, title: '换班测试', deadline: Date.now() + 3600_000, submitType: 'text',
  }, tokens.teacher))).id;
  // PUT 换到第二个班
  assert.equal((await req('PUT', `/api/assignments/${aid}`, { classId: classes[1].id }, tokens.teacher)).status, 200);
  const list = await j(await req('GET', '/api/assignments', undefined, tokens.teacher));
  const a = list.find((x: any) => x.id === aid);
  assert.equal(a.classId, classes[1].id);
  // 换到不存在的班级 → 400
  assert.equal((await req('PUT', `/api/assignments/${aid}`, { classId: 99999 }, tokens.teacher)).status, 400);
});

test('教师重置学生密码为学号', async () => {
  const classes = await j(await req('GET', '/api/classes', undefined, tokens.teacher));
  const students = await j(await req('GET', `/api/classes/${classes[0].id}/students`, undefined, tokens.teacher));
  const s2 = students.find((x: any) => x.studentNo === 'S002');
  // S002 当前密码 = 学号;先改掉再重置,验证闭环
  await req('POST', '/api/change-password', { oldPassword: 'S002', newPassword: 'tmp123' }, tokens.S002);
  assert.equal((await req('POST', '/api/login', { login: 'S002', password: 'S002' })).status, 401);
  // 学生无权重置
  assert.equal((await req('POST', `/api/students/${s2.id}/reset-password`, undefined, tokens.S001)).status, 403);
  assert.equal((await req('POST', `/api/students/${s2.id}/reset-password`, undefined, tokens.teacher)).status, 200);
  assert.equal((await req('POST', '/api/login', { login: 'S002', password: 'S002' })).status, 200);
  assert.equal((await req('POST', `/api/students/99999/reset-password`, undefined, tokens.teacher)).status, 404);
});
