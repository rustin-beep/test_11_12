/**
 * 数据库层:node:sqlite(零依赖),单文件 data/homework.db
 * 时间一律存 UTC 毫秒时间戳,展示由前端完成。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashPassword } from './auth.ts';
import { simhash } from './util/simhash.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '..', 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(__dirname, '..', 'uploads');

export function openDb(dbPath?: string) {
  const file = dbPath ?? join(DATA_DIR, 'homework.db');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    login         TEXT NOT NULL UNIQUE,
    student_no    TEXT UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('teacher','student'))
  );
  CREATE TABLE IF NOT EXISTS classes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (class_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    deadline      INTEGER NOT NULL,
    allow_late    INTEGER NOT NULL DEFAULT 0,
    late_deadline INTEGER,
    submit_type   TEXT NOT NULL DEFAULT 'both' CHECK(submit_type IN ('file','text','both')),
    version       INTEGER NOT NULL DEFAULT 1,
    created_by    INTEGER NOT NULL REFERENCES users(id),
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT,
    file_path     TEXT,
    file_name     TEXT,
    file_size     INTEGER,
    submitted_at  INTEGER NOT NULL,
    is_late       INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    score         REAL,
    comment       TEXT,
    scored_at     INTEGER,
    file_md5      TEXT,
    file_simhash  TEXT,
    UNIQUE (assignment_id, student_id)   -- ★ 防重复提交的数据库层保证
  );
  CREATE TABLE IF NOT EXISTS submission_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    content       TEXT,
    file_path     TEXT,
    file_name     TEXT,
    submitted_at  INTEGER NOT NULL
  );
  `);
}

/** 初始化默认教师(无教师时):teacher / 123456 */
export function seedTeacher(db: DatabaseSync) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role='teacher'`).get() as { c: number };
  if (row.c === 0) {
    db.prepare(`INSERT INTO users (login, student_no, name, password_hash, role) VALUES (?,?,?,?,?)`)
      .run('teacher', null, '教师', hashPassword('123456'), 'teacher');
  }
}

/** 中文数字(1~99):1→一, 10→十, 15→十五, 21→二十一 */
function cnNum(n: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + d[n - 10];
  const tens = Math.floor(n / 10), ones = n % 10;
  return d[tens] + '十' + (ones ? d[ones] : '');
}

/**
 * 初始演示数据(仅空库时创建,已有任何班级则跳过):
 * - 班级「电气工程及其自动化2025160262班」,60 名学生(学号 2025160262xx,姓名 = 姓 + 中文数字,密码 = 学号)
 * - 4 个不同状态的作业,并预置提交/批阅/查重数据:
 *   A 电气工程实践报告 —— 进行中(7 天后截止),12 人已交、5 人已批
 *   B 电路分析基础习题集 —— 已截止(3 天前),45 人已交、20 人已批、含一组相似文本
 *   C 电机拖动实验报告 —— 补交中(2 天前截止,可补交至 3 天后),47 人已交(5 人逾期)、含相同文件组
 *   D 自动控制原理小测 —— 临近截止(5 小时后),3 人已交
 */
export function seedDemo(db: DatabaseSync) {
  const has = db.prepare('SELECT COUNT(*) AS c FROM classes').get() as { c: number };
  if (has.c > 0) return;

  const now = Date.now();
  const DAY = 86400_000, HOUR = 3600_000;

  const classInfo = db.prepare('INSERT INTO classes (name, created_at) VALUES (?,?)')
    .run('电气工程及其自动化2025160262班', now);
  const classId = Number(classInfo.lastInsertRowid);

  // 序列刻意排布使 3号=张三、4号=李四、15号=黄十五(与示例一致),其余按百家姓风格循环
  const surnames = ['赵', '钱', '张', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '黄', '韩', '杨', '朱', '秦', '尤'];
  const nos: string[] = [], names: string[] = [], uids: number[] = [];
  for (let i = 1; i <= 60; i++) {
    const no = `2025160262${String(i).padStart(2, '0')}`;
    const name = surnames[(i - 1) % surnames.length] + cnNum(i);
    const uid = Number(db.prepare(
      'INSERT INTO users (login, student_no, name, password_hash, role) VALUES (?,?,?,?,?)'
    ).run(no, no, name, hashPassword(no), 'student').lastInsertRowid);
    db.prepare('INSERT INTO enrollments (class_id, student_id) VALUES (?,?)').run(classId, uid);
    nos.push(no); names.push(name); uids.push(uid);
  }

  const teacher = db.prepare(`SELECT id FROM users WHERE role='teacher' LIMIT 1`).get() as { id: number };
  const mkAssignment = (title: string, description: string, deadline: number, allowLate: 0 | 1 = 0, lateDeadline: number | null = null, submitType: string = 'both') =>
    Number(db.prepare(`
      INSERT INTO assignments (class_id, title, description, deadline, allow_late, late_deadline, submit_type, version, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,1,?,?)`)
      .run(classId, title, description, deadline, allowLate, lateDeadline, submitType, teacher.id, now - DAY).lastInsertRowid);

  // 提交工厂:文本 / 文本文件(算 simhash)/ 二进制文件(仅 md5) / 逾期 / 批阅
  const submit = (aid: number, i: number, o: { content?: string; fileName?: string; fileText?: string; fileBytes?: Buffer; at: number; late?: boolean; score?: number; comment?: string }) => {
    let filePath: string | null = null, md5: string | null = null, sim: string | null = null, size: number | null = null;
    if (o.fileText != null || o.fileBytes != null) {
      const buf = o.fileBytes ?? Buffer.from(o.fileText as string, 'utf8');
      md5 = createHash('md5').update(buf).digest('hex');
      const dir = join(UPLOAD_DIR, String(aid));
      mkdirSync(dir, { recursive: true });
      filePath = join(dir, `${nos[i - 1]}_${o.at}_${o.fileName}`);
      writeFileSync(filePath, buf);
      size = buf.length;
      if (o.fileText != null) sim = simhash(o.fileText).toString(16); // 二进制(扫描件等)不做文本指纹
    }
    if (!sim && o.content) sim = simhash(o.content).toString(16);
    db.prepare(`
      INSERT INTO submissions (assignment_id, student_id, content, file_path, file_name, file_size, submitted_at, is_late, attempt_count, score, comment, scored_at, file_md5, file_simhash)
      VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?)`)
      .run(aid, uids[i - 1], o.content ?? null, filePath, o.fileName ?? null, size, o.at, o.late ? 1 : 0,
        o.score ?? null, o.comment ?? null, o.score != null ? o.at + 3600_000 : null, md5, sim);
  };
  // 扫描件类"PDF"(确定性伪随机字节,md5 各异,不参与文本查重)
  const scanPdf = (aid: number, i: number, label: string, at: number, extra: { late?: boolean; score?: number; comment?: string } = {}) => {
    const bytes = Buffer.alloc(128 + (i * 37) % 512);
    for (let k = 0; k < bytes.length; k++) bytes[k] = (i * 131 + k * 7) % 251;
    submit(aid, i, { fileName: `${label}_第${cnNum(i)}组.pdf`, fileBytes: bytes, at, ...extra });
  };

  // 五个措辞差异明显的模板(每份文本只用其中一个,避免普通作业互相误报相似)
  const templates = [
    '三相异步电动机的正反转控制通过互换任意两相电源相序实现。控制电路采用接触器互锁与按钮互锁的双重互锁结构,防止两接触器同时吸合造成相间短路。',
    '星三角降压启动适用于正常运行时定子绕组为三角形接法的电动机:启动阶段绕组接成星形,相电压降为额定的 1/√3,启动电流降为直接启动的三分之一,待转速接近额定后切换为三角形运行。',
    'PLC 梯形图程序由自锁环节、延时切换与保护环节构成:启动按钮与接触器辅助常开触点并联实现自锁,T37 定时器整定 6 秒用于星三角切换,热继电器常闭触点串入控制回路实现过载保护。',
    '变压器空载实验测得励磁电流约为额定电流的 4.2%,空载损耗主要为铁耗;短路实验中短路电压约为额定的 5.8%,短路损耗主要为铜耗,由此可分离变压器的铁耗与铜耗。',
    '电力系统短路计算采用标幺值法:先取基准容量与基准电压,将各元件阻抗归算至同一基准,再按网络化简求出短路点等值电抗,最终求得短路电流周期分量起始值及冲击电流。',
  ];
  const personal = (i: number) => ''; // 演示文本用纯模板,确保不同模板之间文本指纹距离足够大,查重只命中刻意构造的相似对

  const comments = ['报告规范,数据完整', '思路清晰,分析到位', '格式良好,结论正确', '内容较简略,建议补充实验分析', '数据准确,电路图规范'];

  // ---- A 电气工程实践报告:进行中,12 交 5 批 ----
  const aidA = mkAssignment('电气工程实践报告',
    '设计三相异步电动机正反转控制线路,撰写实践报告并提交(上传文件或填写内容均可)。', now + 7 * DAY);
  for (let i = 1; i <= 5; i++)
    submit(aidA, i, { content: templates[i - 1] + personal(i), at: now - (13 - i) * HOUR, ...(i <= 5 ? { score: [92, 88, 95, 85, 90][i - 1], comment: comments[i - 1] } : {}) });
  for (let i = 6; i <= 12; i++) scanPdf(aidA, i, '实践报告', now - (13 - i) * HOUR);

  // ---- B 电路分析基础习题集:已截止,43 交 20 批,含一组相似文本 ----
  const aidB = mkAssignment('电路分析基础习题集',
    '完成教材第三章习题 3-2、3-5、3-8,写出完整求解过程。', now - 3 * DAY);
  for (let i = 1; i <= 5; i++)
    submit(aidB, i, { content: templates[(i + 1) % 5], at: now - 3 * DAY - 2 * HOUR + i * 20 * 60_000, ...(i <= 20 ? { score: 75 + ((i * 7) % 21), comment: comments[i % 5] } : {}) });
  for (let i = 6; i <= 40; i++)
    scanPdf(aidB, i, '习题解答', now - 3 * DAY - 2 * HOUR + i * 20 * 60_000, i <= 20 ? { score: 75 + ((i * 7) % 21), comment: comments[i % 5] } : {});
  const plc1 = 'PLC 控制系统设计报告:本次课程设计以西门子 S7-1200 为核心控制器,完成三相异步电动机的星三角降压启动控制。硬件部分包括主电路与控制电路,软件采用梯形图编程,设置互锁与过载保护。经仿真与联机调试,系统启动电流明显降低,运行稳定可靠。';
  const plc2 = 'PLC 控制系统设计报告:本次课程设计以西门子 S7-1200 为核心控制器,完成三相异步电动机的星三角降压启动控制。硬件部分包括主电路与控制电路,软件采用梯形图编程,设置互锁与过载保护。经调试,系统运行稳定可靠。';
  submit(aidB, 41, { content: plc1, at: now - 3 * DAY - HOUR });
  submit(aidB, 42, { content: plc2, at: now - 3 * DAY - HOUR + 5 * 60_000 }); // 相似对演示
  submit(aidB, 43, { fileName: '习题解答.txt', fileText: `3-2:戴维南等效,开路电压 12V,等效电阻 4Ω,负载电流 2A。\n3-5:叠加定理,分别作用后叠加得 U=9V。\n3-8:一阶电路三要素法,τ=RC=2ms,uC(∞)=6V。`, at: now - 3 * DAY - 90 * 60_000 });

  // ---- C 电机拖动实验报告:补交中(2 天前截止,可补交 3 天),49 交(5 逾期),含相同文件组 ----
  const aidC = mkAssignment('电机拖动实验报告',
    '完成他励直流电动机特性测试实验,提交实验报告(文件或文本均可)。', now - 2 * DAY, 1, now + 3 * DAY);
  for (let i = 1; i <= 5; i++)
    submit(aidC, i, { content: templates[(i + 2) % 5], at: now - 2 * DAY - HOUR, ...(i <= 3 ? { score: [91, 87, 94][i - 1], comment: comments[i + 1] } : {}) });
  for (let i = 6; i <= 41; i++) scanPdf(aidC, i, '实验报告', now - 2 * DAY - HOUR + i * 60_000);
  submit(aidC, 42, { fileName: '正反转控制.c', fileText: '#include <stdio.h>\n/* 电机正反转控制流程(演示) */\nint main(void){\n  int run=1,dir=0;\n  while(run){\n    if(dir) printf("KM1吸合 正转\\n");\n    else    printf("KM2吸合 反转\\n");\n    run=0;\n  }\n  return 0;\n}\n', at: now - 2 * DAY - 30 * 60_000 });
  const motorData = `额定电压 380V\n额定电流 5.4A\n额定转速 1440r/min\n最大转矩/额定转矩 2.2\n启动电流/额定电流 6.5\n绝缘等级 B 温升 45K`;
  submit(aidC, 43, { fileName: '电动机特性测试数据.txt', fileText: motorData, at: now - 2 * DAY - 25 * 60_000 });
  submit(aidC, 44, { fileName: '电动机特性测试数据.txt', fileText: motorData, at: now - 2 * DAY - 10 * 60_000 }); // 相同文件组演示
  for (let i = 45; i <= 49; i++) scanPdf(aidC, i, '补交报告', now - DAY, { late: true }); // 逾期已交

  // ---- D 自动控制原理小测:临近截止(45 分钟,演示橙色倒计时),3 交 ----
  const aidD = mkAssignment('自动控制原理小测',
    '简述闭环控制系统的基本组成与调节过程(150 字左右),在线填写提交。', now + 45 * 60_000, 0, null, 'text');
  const quizTexts = [
    '闭环系统包含给定、比较、放大、执行、反馈五个环节。输出量经反馈环节送回输入端与给定量比较,偏差经放大后驱动执行机构,使被控量向给定值靠拢,靠拢过程中偏差不断缩小,最终系统在新平衡点稳定运行。',
    '我用电机调速的例子理解闭环调节:测速发电机实时测得转速并回送,与给定转速比较产生偏差电压,经放大器抬高电枢电压,转速随之上升,偏差减小到零附近时电机维持在期望转速,扰动出现后同样机理自动纠正。',
    '反馈控制的核心是"检测偏差、纠正偏差"。温度控制中,热电偶测出炉温与设定值之差,调节器据此改变加热电流:炉温偏低则电流增大、偏高则减小,炉温最终稳定在设定值附近的小范围内波动。',
  ];
  for (let i = 1; i <= 3; i++)
    submit(aidD, i, { content: quizTexts[i - 1], at: now - 10 * 60_000 });
}
