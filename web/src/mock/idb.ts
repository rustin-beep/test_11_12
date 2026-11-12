/** 静态演示版浏览器存储:localStorage 存结构化数据,IndexedDB 存提交文件 */

const DB_KEY = 'hw_demo_db_v1';
const FILE_DB = 'hw_demo_files';
const FILE_STORE = 'files';

export interface DbUser {
  id: number; login: string; studentNo: string | null; name: string;
  passSalt: string; passHash: string; role: 'teacher' | 'student';
}
export interface DbClass { id: number; name: string; createdAt: number }
export interface DbEnrollment { classId: number; studentId: number }
export interface DbAssignment {
  id: number; classId: number; title: string; description: string;
  deadline: number; allowLate: 0 | 1; lateDeadline: number | null;
  submitType: 'file' | 'text' | 'both'; version: number; createdBy: number; createdAt: number;
}
export interface DbSubmission {
  id: number; assignmentId: number; studentId: number;
  content: string | null; fileName: string | null; fileKey: string | null; fileSize: number | null;
  submittedAt: number; isLate: 0 | 1; attemptCount: number;
  score: number | null; comment: string | null; scoredAt: number | null;
  fileMd5: string | null; fileSimhash: string | null;
}
export interface DbHistory { id: number; submissionId: number; content: string | null; fileName: string | null; submittedAt: number }
export interface Db {
  users: DbUser[]; classes: DbClass[]; enrollments: DbEnrollment[];
  assignments: DbAssignment[]; submissions: DbSubmission[]; history: DbHistory[];
  sessions: Record<string, { uid: number; exp: number }>;
  nextId: number;
}

export function loadDb(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch { /* 损坏则重置 */ }
  return { users: [], classes: [], enrollments: [], assignments: [], submissions: [], history: [], sessions: {}, nextId: 1 };
}

export function saveDb(db: Db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function nextId(db: Db): number { return db.nextId++; }

// ---------- 密码:SHA-256 + 盐(演示级,非 scrypt) ----------
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(plain: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.randomUUID().replace(/-/g, '');
  return { salt, hash: await sha256(`hw:${salt}:${plain}`) };
}
export async function verifyPassword(plain: string, salt: string, hash: string): Promise<boolean> {
  return (await sha256(`hw:${salt}:${plain}`)) === hash;
}

// ---------- IndexedDB 文件存取 ----------
function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putFile(key: string, buf: ArrayBuffer): Promise<void> {
  const dbConn = await openFileDb();
  const tx = dbConn.transaction(FILE_STORE, 'readwrite');
  tx.objectStore(FILE_STORE).put(buf, key);
  await txDone(tx);
  dbConn.close();
}
export async function getFile(key: string): Promise<ArrayBuffer | null> {
  const dbConn = await openFileDb();
  const req = new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = dbConn.transaction(FILE_STORE, 'readonly');
    const r = tx.objectStore(FILE_STORE).get(key);
    r.onsuccess = () => resolve((r.result as ArrayBuffer) ?? null);
    r.onerror = () => reject(r.error);
  });
  const out = await req;
  dbConn.close();
  return out;
}
