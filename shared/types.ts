/** 前后端共享的类型定义(Node 22+ 直接跑 TS,前端 Vite 打包,两边引用同一份) */

export type Role = 'teacher' | 'student';

export interface User {
  id: number;
  login: string;        // 学生=学号,教师=登录名
  studentNo: string | null;
  name: string;
  role: Role;
}

export type SubmitType = 'file' | 'text' | 'both';

export interface Assignment {
  id: number;
  classId: number;
  className: string;
  title: string;
  description: string;
  deadline: number;            // UTC 毫秒时间戳
  allowLate: 0 | 1;
  lateDeadline: number | null; // 逾期补交绝对截止
  submitType: SubmitType;
  version: number;             // 截止时间等关键信息变更 +1,学生端轮询感知
  createdAt: number;
}

/** 学生视角的作业(带本人提交摘要) */
export interface StudentAssignment extends Assignment {
  my: MySubmission | null;
}

export interface MySubmission {
  id: number;
  submittedAt: number;
  isLate: 0 | 1;
  attemptCount: number;
  fileName: string | null;
  content: string | null;
  score: number | null;
  comment: string | null;
  scoredAt: number | null;
  /** 覆盖提交的历史版本(服务端在详情接口附带) */
  history?: { content: string | null; fileName: string | null; submittedAt: number }[];
}

/** 教师视角的作业列表项(带统计数) */
export interface TeacherAssignment extends Assignment {
  total: number;       // 应交人数
  submitted: number;   // 已交(含逾期已交)
  scored: number;      // 已批
}

export interface ClassInfo {
  id: number;
  name: string;
  studentCount: number;
}

export interface StudentRow {
  id: number;
  studentNo: string;
  name: string;
}

/** 统计页单条提交记录 */
export interface StatsSubmission {
  submissionId: number;
  studentId: number;
  studentNo: string;
  name: string;
  submittedAt: number;
  isLate: 0 | 1;
  attemptCount: number;
  fileName: string | null;
  content: string | null;
  score: number | null;
  comment: string | null;
}

export interface MissingRow {
  studentId: number;
  studentNo: string;
  name: string;
}

/** 查重:完全相同的文件分组 */
export interface DuplicateGroup {
  md5: string;
  members: { studentNo: string; name: string; fileName: string | null }[];
}

/** 查重:文本相似对(simhash) */
export interface SimilarPair {
  a: { studentNo: string; name: string };
  b: { studentNo: string; name: string };
  similarity: number; // 0~1
}

export interface AssignmentStats {
  assignment: Assignment;
  total: number;
  onTime: StatsSubmission[];
  late: StatsSubmission[];
  missing: MissingRow[];
  duplicates: DuplicateGroup[];
  similar: SimilarPair[];
}

export type SubmitBody = {
  content?: string | null;
  fileName?: string | null;
  fileB64?: string | null; // 文件 base64(方案A),单文件 ≤ 8MB
};

/** 作业提交窗口状态(纯函数,测试覆盖) */
export type WindowState = 'open' | 'late' | 'closed';

export function submitWindow(a: { deadline: number; allowLate: number; lateDeadline: number | null }, now: number): WindowState {
  if (now <= a.deadline) return 'open';
  if (a.allowLate && a.lateDeadline != null && now <= a.lateDeadline) return 'late';
  return 'closed';
}
