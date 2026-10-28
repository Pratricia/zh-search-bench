import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tokens } from '../src/tokenize.mjs';

/**
 * 数据体检：验证「标准答案」本身自洽，且没有过期。
 *
 * 基准最容易出错的地方不是指标，是数据和标注。这个脚本检查：
 *   1. 相关文档 id 都存在
 *   2. 每条「相关」都真的能在原文里找到查询（字面包含）
 *   3. 原文里含查询的文档，一条都没漏标
 *   4. queries.json 是否和当前语料对得上（防止改了语料忘了重生成查询）
 *   5. 二元组方案在结构上无法命中的查询有多少（解释单字短板）
 *   6. 标题有没有被代码块污染
 *
 * 用法：npm run check（发现问题时退出码为 1）
 */

const problems = [];
const corpusRaw = readFileSync('data/corpus.jsonl', 'utf8');
const docs = corpusRaw
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const byId = new Map(docs.map((d) => [d.id, d]));
const { queries, corpusDocs, corpusHash: recordedHash } = JSON.parse(readFileSync('data/queries.json', 'utf8'));
const corpusHash = createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16);

// 0. 过期检查：篇数相同但内容被改过（比如改了清洗规则）也必须能发现
if (corpusDocs !== docs.length) {
  problems.push(`queries.json 是按 ${corpusDocs} 篇语料生成的，当前语料是 ${docs.length} 篇——请重跑 npm run queries`);
}
if (recordedHash !== corpusHash) {
  problems.push(`语料指纹不一致（记录 ${recordedHash ?? '无'}，当前 ${corpusHash}）——请重跑 npm run queries`);
}

// 1 & 2. 相关文档存在，且真的包含查询
let missingIds = 0;
let notContained = 0;
const badExamples = [];
for (const q of queries) {
  for (const id of q.relevant) {
    const doc = byId.get(id);
    if (!doc) {
      missingIds++;
      continue;
    }
    if (!doc.text.includes(q.q)) {
      notContained++;
      if (badExamples.length < 5) badExamples.push([q.q, id]);
    }
  }
}

// 3. 漏标：原文含查询但不在 relevant 里
let missed = 0;
for (const q of queries) {
  for (const doc of docs) {
    if (doc.text.includes(q.q) && !q.relevant.includes(doc.id)) {
      missed++;
      if (badExamples.length < 10) badExamples.push([`漏标: ${q.q}`, doc.id]);
    }
  }
}

if (missingIds) problems.push(`${missingIds} 个相关文档 id 在语料里不存在`);
if (notContained) problems.push(`${notContained} 对「相关」在原文里并不包含查询`);
if (missed) problems.push(`${missed} 篇含查询的文档被漏标`);

// 4. 二元组结构可达性
const unreachable = new Map();
for (const q of queries) {
  const source = byId.get(q.relevant[0]);
  if (!source) continue;
  const docTokens = new Set(tokens(source.text));
  if (tokens(q.q).some((t) => !docTokens.has(t))) {
    unreachable.set(q.set, (unreachable.get(q.set) ?? 0) + 1);
  }
}

// 5. 标题污染
const suspicious = docs
  .map((d) => d.title)
  .filter((t) => /^(#|\/\/|const |let |var |import |<!--|```|===|---|\||<)/.test(t) || t.includes('```'));

if (suspicious.length) problems.push(`${suspicious.length} 个标题疑似来自代码块`);
if (suspicious.length) console.log('可疑标题示例:', suspicious.slice(0, 5));

// 6. 长度分布
const lens = docs.map((d) => d.text.length).sort((a, b) => a - b);
const pct = (p) => lens[Math.floor(lens.length * p)];

const relevantPairs = queries.reduce((a, q) => a + q.relevant.length, 0);

console.log(`语料 ${docs.length} 篇，${queries.length} 条查询，${relevantPairs} 对相关标注`);
console.log(
  `长度分位 p10 ${pct(0.1)} / p50 ${pct(0.5)} / p90 ${pct(0.9)} / max ${lens.at(-1)} 字`,
);
console.log('二元组结构上无法命中的查询（按查询集）:');
for (const [set, n] of unreachable) {
  const total = queries.filter((q) => q.set === set).length;
  console.log(`  ${set.padEnd(12)} ${n}/${total}`);
}

if (problems.length) {
  console.error('\n发现问题:');
  for (const p of problems) console.error(`  - ${p}`);
  if (badExamples.length) console.error('  示例:', badExamples);
  process.exit(1);
}

console.log('\n数据自洽，无过期标注。');
