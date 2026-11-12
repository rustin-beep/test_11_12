/** CSV 解析与生成(手写,零依赖)。导出带 BOM,Excel 双击不乱码。 */

/** 解析 CSV 文本 → 二维数组。支持引号包裹、引号转义("")、\r\n */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, ''); // 去掉可能的 BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** 单元格转义:含逗号/引号/换行时用引号包裹 */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 生成 CSV(带 BOM) */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map(r => r.map(esc).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
