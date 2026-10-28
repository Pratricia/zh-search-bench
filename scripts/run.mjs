import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ADAPTERS } from '../src/adapters.mjs';

/**
 * 跑基准测试。
 *
 * 指标（k = 10）：
 *   hit@10    —— 前 10 条里至少有一条相关文档的查询占比
 *   P@10      —— 前 10 条里相关文档数 / 10（标准定义，分母固定为 k）
 *   R@10      —— 前 10 条覆盖了多少比例的相关文档
 *   MRR       —— 第一条相关结果排名的倒数均值
 *
 * 另有构建耗时、查询延迟、索引体积。
 */

const K = 10;
const LIMIT = Number(process.env.BENCH_LIMIT || 0); // 冒烟测试用：分层抽样 N 条

const docs = readFileSync('data/corpus.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const validIds = new Set(docs.map((d) => d.id));

const { queries, sets } = JSON.parse(readFileSync('data/queries.json', 'utf8'));

/**
 * 分层抽样。
 * 查询是按查询集顺序排列的（单字在前），直接 slice(0, N) 会导致
 * BENCH_LIMIT 冒烟测试只跑到单字查询，结论完全失真。
 */
function stratified(list, n) {
  if (!n || n >= list.length) return list;
  const buckets = new Map();
  for (const q of list) {
    let b = buckets.get(q.set);
    if (!b) buckets.set(q.set, (b = []));
    b.push(q);
  }
  const queues = [...buckets.values()].map((b) => b.slice());
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const q = queues[i % queues.length].shift();
    if (q) out.push(q);
    if (queues.every((b) => b.length === 0)) break;
  }
  return out;
}

const useQueries = stratified(queries, LIMIT);

const round = (x, n = 4) => +x.toFixed(n);

function evaluate(results, query) {
  const relevant = new Set(query.relevant);
  const top = [];
  const seen = new Set();
  let invalid = 0;

  for (const id of Array.isArray(results) ? results : []) {
    // 适配器返回未知 id（或 undefined）时必须显式记账，
    // 否则会被当成“没搜到”，把适配器的 bug 混进召回率里
    if (typeof id !== 'string' || !validIds.has(id)) {
      invalid++;
      continue;
    }
    if (seen.has(id)) continue; // 去重，避免重复结果刷高 recall/precision
    seen.add(id);
    top.push(id);
    if (top.length === K) break;
  }

  let hit = 0;
  let first = 0;
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) {
      hit++;
      if (!first) first = i + 1;
    }
  }

  return {
    anyHit: hit > 0 ? 1 : 0,
    recall: hit / relevant.size,
    precision: hit / K, // 标准 P@10：分母固定是 10
    rr: first ? 1 / first : 0,
    invalid,
  };
}

// 预热动态 import，避免“第一个用某库的适配器”把模块加载时间算进构建耗时
for (const mod of [
  'flexsearch',
  'minisearch',
  'lunr',
  'fuse.js',
  '@orama/orama',
  '@orama/tokenizers/mandarin',
]) {
  try {
    await import(mod);
  } catch {
    /* 适配器会自己报错 */
  }
}

const rows = [];

for (const adapter of ADAPTERS) {
  process.stdout.write(`跑 ${adapter.label} … `);
  const t0 = performance.now();
  let engine;
  try {
    engine = await adapter.build(docs);
  } catch (err) {
    console.log(`构建失败: ${err.message}`);
    rows.push({ id: adapter.id, label: adapter.label, error: String(err.message) });
    continue;
  }
  const buildMs = performance.now() - t0;

  const bySet = new Map();
  const latencies = [];
  const failures = [];
  let invalidResults = 0;

  for (const query of useQueries) {
    const q0 = performance.now();
    let results = [];
    try {
      results = await engine.search(query.q, K);
    } catch (err) {
      results = [];
      if (failures.length < 3) failures.push(`${query.q}: ${err.message}`);
    }
    latencies.push(performance.now() - q0);

    const score = evaluate(results, query);
    invalidResults += score.invalid;

    let bucket = bySet.get(query.set);
    if (!bucket) bySet.set(query.set, (bucket = { n: 0, anyHit: 0, recall: 0, precision: 0, rr: 0 }));
    bucket.n++;
    bucket.anyHit += score.anyHit;
    bucket.recall += score.recall;
    bucket.precision += score.precision;
    bucket.rr += score.rr;
  }

  const perSet = {};
  for (const [name, b] of bySet) {
    perSet[name] = {
      queries: b.n,
      hitAt10: round((b.anyHit / b.n) * 100, 1),
      precisionAt10: round((b.precision / b.n) * 100, 1),
      recallAt10: round((b.recall / b.n) * 100, 1),
      mrr: round(b.rr / b.n, 3),
    };
  }

  latencies.sort((a, b) => a - b);
  const overall = (() => {
    const all = [...bySet.values()];
    const n = all.reduce((a, b) => a + b.n, 0);
    if (n === 0) return { queries: 0, hitAt10: 0, precisionAt10: 0, recallAt10: 0, mrr: 0 };
    return {
      queries: n,
      hitAt10: round((all.reduce((a, b) => a + b.anyHit, 0) / n) * 100, 1),
      precisionAt10: round((all.reduce((a, b) => a + b.precision, 0) / n) * 100, 1),
      recallAt10: round((all.reduce((a, b) => a + b.recall, 0) / n) * 100, 1),
      mrr: round(all.reduce((a, b) => a + b.rr, 0) / n, 3),
    };
  })();

  let size = null;
  try {
    size = engine.size?.() ?? null;
  } catch {
    size = null;
  }

  if (invalidResults > 0) {
    failures.push(`返回了 ${invalidResults} 个未知/重复 id，已忽略`);
  }

  rows.push({
    id: adapter.id,
    label: adapter.label,
    overall,
    perSet,
    buildMs: round(buildMs, 1),
    latencyP50Ms: latencies.length ? round(latencies[Math.floor(latencies.length / 2)], 3) : null,
    sizeBytes: size,
    invalidResults,
    failures,
  });
  console.log(
    `hit@10 ${overall.hitAt10}%  P@10 ${overall.precisionAt10}%  MRR ${overall.mrr}  构建 ${Math.round(buildMs)}ms`,
  );
}

mkdirSync('results', { recursive: true });
const meta = JSON.parse(readFileSync('data/meta.json', 'utf8'));
writeFileSync(
  'results/results.json',
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      corpus: { documents: meta.documents, chars: meta.totalChars, sources: meta.sources },
      querySets: sets,
      k: K,
      limit: LIMIT || null,
      rows,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('\n结果已写入 results/results.json');
