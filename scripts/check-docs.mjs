import { readFileSync } from 'node:fs';

const r = JSON.parse(readFileSync('results/results.json', 'utf8'));
const row = (id) => r.rows.find((x) => x.id === id);

function slice(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + 1);
  if (a < 0 || b < 0) throw new Error(`找不到区间: ${start} .. ${end}`);
  return text.slice(a, b);
}

const reportMain = slice(readFileSync('REPORT.md', 'utf8'), '## 总表', '## 关键发现');
const readmeMain = slice(readFileSync('README.md', 'utf8'), '## 结果', '## 总分是被');

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

let bad = 0;
const fail = (m) => {
  bad++;
  console.log('MISMATCH:', m);
};

function checkTable(table, name, ids, labelOverrides = {}) {
  for (const id of ids) {
    const x = row(id);
    const label = labelOverrides[id] ?? LABELS[id];
    const line = table.split('\n').find((l) => l.includes(label));
    if (!line) {
      fail(`${name} 找不到 ${id} 的行（标签「${label}」）`);
      continue;
    }
    const cells = line.split('|');
    const hit = parseFloat(cells[2]);
    const p = parseFloat(cells[3]);
    if (Math.abs(hit - x.overall.hitAt10) > 0.05) fail(`${name} ${id} hit@10: 文档 ${hit} vs 结果 ${x.overall.hitAt10}`);
    if (Math.abs(p - x.overall.precisionAt10) > 0.05) fail(`${name} ${id} P@10: 文档 ${p} vs 结果 ${x.overall.precisionAt10}`);
  }
}

checkTable(reportMain, 'REPORT', Object.keys(LABELS), {
  'lunr/bigram': 'Lunr + 修复 trimmer + 二元组',
});
checkTable(
  readmeMain,
  'README',
  [
    'fuse/exact',
    'orama/custom-tokenizer',
    'lunr/official-zh',
    'flexsearch/bigram',
    'minisearch/bigram',
    'flexsearch/cjk-charset',
    'orama/official-mandarin',
    'flexsearch/default',
    'minisearch/default',
    'lunr/default',
    'orama/default',
  ],
  {
    'lunr/official-zh': '**Lunr + 官方中文插件**',
  },
);

console.log(bad === 0 ? '文档主表数字与 results.json 一致' : `${bad} 处不一致`);

// ── 单字 / 两字以上 / 全部 表格 ──
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

const reportSplit = slice(readFileSync('REPORT.md', 'utf8'), '## 关键发现', '## 发现：修复之后');
const readmeSplit = slice(readFileSync('README.md', 'utf8'), '## 总分是被', '## 失败是两种');

function checkSplit(table, name, ids, overrides = {}) {
  for (const id of ids) {
    const x = row(id);
    const label = overrides[id] ?? LABELS[id];
    const line = table.split('\n').find((l) => l.includes(label));
    if (!line) {
      fail(`${name} 单字表找不到 ${id}`);
      continue;
    }
    const cells = line.split('|');
    const single = parseFloat(cells[2]);
    const multi = parseFloat(cells[3]);
    const all = parseFloat(cells[4]);
    if (Math.abs(single - x.perSet['zh-1char'].hitAt10) > 0.05) fail(`${name} ${id} 单字: ${single} vs ${x.perSet['zh-1char'].hitAt10}`);
    if (Math.abs(multi - multiHit(x)) > 0.05) fail(`${name} ${id} 多字: ${multi} vs ${multiHit(x)}`);
    if (Math.abs(all - x.overall.hitAt10) > 0.05) fail(`${name} ${id} 全部: ${all} vs ${x.overall.hitAt10}`);
  }
}

checkSplit(reportSplit, 'REPORT', Object.keys(LABELS), { 'lunr/bigram': 'Lunr + 修复 + 二元组' });
checkSplit(
  readmeSplit,
  'README',
  ['flexsearch/bigram', 'minisearch/bigram', 'lunr/bigram', 'lunr/official-zh', 'orama/custom-tokenizer'],
  { 'lunr/bigram': 'Lunr + 二元组' },
);

console.log(bad === 0 ? '文档全部数字与 results.json 一致' : `${bad} 处不一致`);
process.exit(bad ? 1 : 0);
