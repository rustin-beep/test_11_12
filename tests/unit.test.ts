/** 单元测试:纯函数(node:test,零依赖) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitWindow } from '../shared/types.ts';
import { parseCsv, toCsv } from '../server/util/csv.ts';
import { simhash, hamming, tokenize } from '../server/util/simhash.ts';
import { fmtRemain, levelOf } from '../web/src/lib/time.ts';

// ---------- 截止窗口判定(核心业务规则) ----------
test('submitWindow:截止边界', () => {
  const a = { deadline: 1000, allowLate: 0, lateDeadline: null };
  assert.equal(submitWindow(a, 999), 'open');
  assert.equal(submitWindow(a, 1000), 'open');     // 恰好在截止时刻:仍可提交
  assert.equal(submitWindow(a, 1001), 'closed');   // 过了即关闭
});

test('submitWindow:允许补交的三段', () => {
  const a = { deadline: 1000, allowLate: 1, lateDeadline: 5000 };
  assert.equal(submitWindow(a, 1000), 'open');
  assert.equal(submitWindow(a, 1001), 'late');
  assert.equal(submitWindow(a, 5000), 'late');
  assert.equal(submitWindow(a, 5001), 'closed');   // 超过补交绝对截止
});

test('submitWindow:allowLate 但没给 lateDeadline → 直接关闭', () => {
  assert.equal(submitWindow({ deadline: 1, allowLate: 1, lateDeadline: null }, 2), 'closed');
});

// ---------- 倒计时格式化与分级 ----------
test('fmtRemain', () => {
  assert.equal(fmtRemain(-1), '已逾期');
  assert.equal(fmtRemain(0), '已逾期');
  assert.equal(fmtRemain(61_000), '00:01:01');
  assert.equal(fmtRemain(3_661_000), '01:01:01');
  assert.equal(fmtRemain(90_061_000), '1天 01:01:01');
});

test('levelOf 四级阈值', () => {
  assert.equal(levelOf(0), 'over');
  assert.equal(levelOf(-5), 'over');
  assert.equal(levelOf(600_000), 'danger');        // 恰好 10 分钟:红色
  assert.equal(levelOf(600_001), 'warn');          // 10 分钟以上:橙色
  assert.equal(levelOf(3_600_000), 'warn');        // 恰好 1 小时:橙色
  assert.equal(levelOf(3_600_001), 'safe');        // 1 小时以上:绿色
});

// ---------- CSV ----------
test('parseCsv:普通/引号/转义/换行/BOM', () => {
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('"a,x",b'), [['a,x', 'b']]);
  assert.deepEqual(parseCsv('"x""y",z'), [['x"y', 'z']]);
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('\uFEFF学号,姓名\nS01,张三'), [['学号', '姓名'], ['S01', '张三']]);
  assert.deepEqual(parseCsv('a,b\n\n\nc,d'), [['a', 'b'], ['c', 'd']]); // 空行过滤
});

test('toCsv:转义与 BOM(Excel 兼容)', () => {
  const csv = toCsv(['学号', '姓名'], [['S01', '张,三'], ['S02', '说"你好"']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"张,三"'));
  assert.ok(csv.includes('"说""你好"""'));
  // 往返:导出的内容能被解析回原结构
  assert.deepEqual(parseCsv(csv), [['学号', '姓名'], ['S01', '张,三'], ['S02', '说"你好"']]);
});

// ---------- Simhash ----------
test('tokenize:英文词 + 中文 bigram', () => {
  assert.deepEqual(tokenize('Hello world'), ['hello', 'world']);
  const zh = tokenize('你好世界');
  assert.deepEqual(zh, ['你好', '好世', '世界']);
});

test('simhash:相同文本距离 0,不同文本距离大,微改文本距离小', () => {
  const t1 = '操作系统是管理计算机硬件与软件资源的程序集合。进程调度、内存管理、文件系统和设备管理是其核心功能。';
  const t2 = '操作系统是管理计算机硬件与软件资源的程序集合。进程调度、内存管理、文件系统和设备管理是其核心功能。';
  const t3 = '红楼梦讲述了贾史王薛四大家族的兴衰。贾宝玉与林黛玉的爱情悲剧是全书的主线之一。';
  const t4 = '操作系统是管理计算机硬件与软件资源的程序集合。进程调度、虚拟内存、文件系统和驱动管理是其重要功能。';
  assert.equal(hamming(simhash(t1), simhash(t2)), 0);
  assert.ok(hamming(simhash(t1), simhash(t3)) > 6, '无关文本应被判为不相似');
  assert.ok(hamming(simhash(t1), simhash(t4)) <= 6, '微改文本应被判为相似');
});
