/**
 * Simhash 文本指纹(BigInt 64 位,零依赖)。
 * 分词:英文/数字连续串 + 中文逐字 bigram(短中文文本也能出区分度)。
 * 用途:提交文本/文本类文件的两两相似度查重。
 */

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 英文单词/数字
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+/g)) tokens.push(m[0]);
  // 中文 bigram
  const han = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of han) {
    if (seg.length === 1) tokens.push(seg);
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  }
  return tokens;
}

export function simhash(text: string): bigint {
  const freq = new Map<string, number>();
  for (const t of tokenize(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const bits = new Array<bigint>(64).fill(0n); // 每位权重累加
  for (const [tok, w] of freq) {
    let h = 0n;
    for (let i = 0; i < tok.length; i++) h = (h * 131n + BigInt(tok.charCodeAt(i))) & 0xffffffffffffffffn;
    // FNV 混淆
    h = (h ^ 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    for (let b = 0; b < 64; b++) bits[b] += (h >> BigInt(b)) & 1n ? BigInt(w) : -BigInt(w);
  }
  let fp = 0n;
  for (let b = 0; b < 64; b++) if (bits[b] > 0n) fp |= 1n << BigInt(b);
  return fp;
}

/** 海明距离(0~64) */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, d = 0;
  while (x) { d += Number(x & 1n); x >>= 1n; }
  return d;
}

/** 相似度 0~1 = 1 - dist/64。距离 ≤ 阈值(默认4)视为疑似相似 */
export function similarity(a: bigint, b: bigint): number {
  return 1 - hamming(a, b) / 64;
}
