import { readFileSync } from 'node:fs';

/**
 * 核对 README / REPORT 里手写的数字与 results/results.json 是否一致。
 * 只解析固定结构的表格，不试图理解正文。
 */

const r = JSON.parse(readFileSync('results/results.json', 'utf8'));
const row = (id) => r.rows.find((x) => x.id === id);
const report = readFileSync('REPORT.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');

function slice(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + 1);
  if (a < 0 || b < 0) throw new Error(`找不到区间: ${start} .. ${end}`);
  return text.slice(a, b);
}

const reportMain = slice(report, '## 总表', '## 关键发现');
const reportSplit = slice(report, '## 关键发现', '## 发现：修复之后');
const readmeMain = slice(readme, '## 结果', '## 怎么跑');

const LABELS = {
  'baseline-bigram': '自建二元组倒排',
  'flexsearch/default': 'FlexSearch（默认）',
  'flexsearch/cjk-charset': 'FlexSearch + 内置 CJK',
  'flexsearch/bigram': 'FlexSearch + 二元组',
  'minisearch/default': 'MiniSearch（默认）',
  'minisearch/bigram': 'MiniSearch + 二元组',
  'lunr/default': 'Lunr（默认）',
  'lunr/unicode-trimmer': 'Lunr（只修 trimmer）',
  'lunr/bigram': 'Lunr + 修复 trimmer + 二元组',
  'fuse/default': 'Fuse.js（默认 0.6）',
  'fuse/exact': 'Fuse.js（阈值 0）',
  'orama/default': 'Orama（默认）',
  'orama/custom-tokenizer': 'Orama + 二元组',
  'lunr/official-zh': 'Lunr + 官方中文插件',
  'orama/official-mandarin': 'Orama + 官方中文分词器',
};

const README_IDS = [
  'fuse/exact',
  'orama/custom-tokenizer',
  'lunr/official-zh',
  'flexsearch/bigram',
  'minisearch/bigram',
  'lunr/bigram',
  'baseline-bigram',
  'flexsearch/cjk-charset',
  'orama/official-mandarin',
  'fuse/default',
  'flexsearch/default',
  'minisearch/default',
  'lunr/unicode-trimmer',
  'lunr/default',
  'orama/default',
];

const MULTI = ['zh-2char', 'zh-3char', 'zh-4char', 'zh-phrase', 'handwritten'];
const multiHit = (x) => {
  let n = 0;
  let h = 0;
  for (const s of MULTI) {
    const b = x.perSet[s];
    if (!b) continue;
    n += b.queries;
    h += (b.hitAt10 * b.queries) / 100;
  }
  return +((h / n) * 100).toFixed(1);
};

let bad = 0;
const fail = (m) => {
  bad++;
  console.log('MISMATCH:', m);
};

function cellsOf(table, label, name) {
  const line = table.split('\n').find((l) => l.includes(label));
  if (!line) {
    fail(`${name} 找不到「${label}」`);
    return null;
  }
  return line.split('|').map((s) => s.trim());
}

const near = (a, b) => Math.abs(a - b) <= 0.05;
// 单元格里可能有 ** 加粗、% 百分号，统一剥掉再解析
const num = (s) => parseFloat(String(s).replace(/[^\d.-]/g, ''));

// 主表：| 配置 | hit@10 | P@10 | ... |
function checkMain(table, name, ids, overrides = {}) {
  for (const id of ids) {
    const x = row(id);
    const cells = cellsOf(table, overrides[id] ?? LABELS[id], name);
    if (!cells) continue;
    const hit = num(cells[2]);
    const p = num(cells[3]);
    if (!near(hit, x.overall.hitAt10)) fail(`${name} ${id} hit@10: 文档 ${hit} vs 结果 ${x.overall.hitAt10}`);
    if (!near(p, x.overall.precisionAt10)) fail(`${name} ${id} P@10: 文档 ${p} vs 结果 ${x.overall.precisionAt10}`);
  }
}

checkMain(reportMain, 'REPORT', Object.keys(LABELS));
checkMain(readmeMain, 'README', README_IDS, {
  'fuse/exact': 'Fuse.js（阈值 0，基准）',
});

// README 第四列是「两字以上」
for (const id of README_IDS) {
  const x = row(id);
  const label = id === 'fuse/exact' ? 'Fuse.js（阈值 0，基准）' : LABELS[id];
  const cells = cellsOf(readmeMain, label, 'README');
  if (!cells) continue;
  const multi = num(cells[4]);
  if (!near(multi, multiHit(x))) fail(`README ${id} 两字以上: 文档 ${multi} vs 结果 ${multiHit(x)}`);
}

// REPORT 单字 / 两字以上 / 全部：| 配置 | 单字 | 两字以上 | 全部 |
for (const id of Object.keys(LABELS)) {
  const x = row(id);
  const label = id === 'lunr/bigram' ? 'Lunr + 修复 + 二元组' : LABELS[id];
  const cells = cellsOf(reportSplit, label, 'REPORT');
  if (!cells) continue;
  const single = num(cells[2]);
  const multi = num(cells[3]);
  const all = num(cells[4]);
  if (!near(single, x.perSet['zh-1char'].hitAt10)) fail(`REPORT ${id} 单字: ${single} vs ${x.perSet['zh-1char'].hitAt10}`);
  if (!near(multi, multiHit(x))) fail(`REPORT ${id} 两字以上: ${multi} vs ${multiHit(x)}`);
  if (!near(all, x.overall.hitAt10)) fail(`REPORT ${id} 全部: ${all} vs ${x.overall.hitAt10}`);
}

console.log(bad === 0 ? '文档数字与 results.json 一致' : `${bad} 处不一致`);
process.exit(bad ? 1 : 0);
