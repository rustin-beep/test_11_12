/** 服务入口:node server/main.ts(开发用 --watch) */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from './server.ts';
import { openDb, seedTeacher, seedDemo, DATA_DIR, UPLOAD_DIR } from './db.ts';
import { setSecret } from './auth.ts';

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

// token 签名密钥:首次生成后持久化(重启不失效)
const secretFile = join(DATA_DIR, 'secret.txt');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
setSecret(readFileSync(secretFile, 'utf8').trim());

const db = openDb();
seedTeacher(db);
seedDemo(db); // 空库时预置:电气2025160262班 · 60 名学生 · 首个电气向作业

const port = Number(process.env.PORT ?? 8080);
const { server } = await startServer({ db, uploadDir: UPLOAD_DIR, port });
console.log(`[homework] 服务已启动: http://localhost:${port}`);
console.log(`[homework] 默认教师账号: teacher / 123456 (首次使用请改密)`);
