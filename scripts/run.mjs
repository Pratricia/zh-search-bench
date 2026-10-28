import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ADAPTERS } from '../src/adapters.mjs';

/**
 * 跑基准测试。
 *
 * 指标：
 *   hit@10    —— 前 10 条里至少有一条是相关文档的查询占比（召回的下限）
 *   recall@10 —— 前 10 条覆盖了多少比例的相关文档
 *   MRR       —— 第一条相关结果排名的倒数均值
 * 另有构建耗时、查询延迟、索引体积。
 */

const K = 10;
const LIMIT = Number(process.env.BENCH_LIMIT || 0); // 冒烟测试用：只跑前 N 条查询

const docs = readFileSync('data/corpus.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const { queries, sets } = JSON.parse(readFileSync('data/queries.json', 'utf8'));
const useQueries = LIMIT ? queries.slice(0, LIMIT) : queries;

const round = (x, n = 4) => +x.toFixed(n);

function evaluate(results, query) {
  const relevant = new Set(query.relevant);
  const top = results.slice(0, K);
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
    precision: top.length ? hit / top.length : 0,
    rr: first ? 1 / first : 0,
  };
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
      recallAt10: round((b.recall / b.n) * 100, 1),
      precisionAt10: round((b.precision / b.n) * 100, 1),
      mrr: round(b.rr / b.n, 3),
    };
  }

  latencies.sort((a, b) => a - b);
  const overall = (() => {
    const all = [...bySet.values()];
    const n = all.reduce((a, b) => a + b.n, 0);
    return {
      queries: n,
      hitAt10: round((all.reduce((a, b) => a + b.anyHit, 0) / n) * 100, 1),
      recallAt10: round((all.reduce((a, b) => a + b.recall, 0) / n) * 100, 1),
      precisionAt10: round((all.reduce((a, b) => a + b.precision, 0) / n) * 100, 1),
      mrr: round(all.reduce((a, b) => a + b.rr, 0) / n, 3),
    };
  })();

  let size = null;
  try {
    size = engine.size?.() ?? null;
  } catch {
    size = null;
  }

  rows.push({
    id: adapter.id,
    label: adapter.label,
    overall,
    perSet,
    buildMs: round(buildMs, 1),
    latencyP50Ms: round(latencies[Math.floor(latencies.length / 2)], 3),
    sizeBytes: size,
    failures,
  });
  console.log(`hit@10 ${overall.hitAt10}%  MRR ${overall.mrr}  构建 ${Math.round(buildMs)}ms`);
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
      rows,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('\n结果已写入 results/results.json');
