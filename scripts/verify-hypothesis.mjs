import { readFileSync } from 'node:fs';

// 验证一个猜测：默认配置偶尔能搜到，是不是因为文档恰好以查询词开头？
const docs = readFileSync('data/corpus.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const { Index } = await import('flexsearch');
const index = new Index();
docs.forEach((d, i) => index.add(i, d.text));

for (const q of ['响应式', '计算属性', '虚拟']) {
  const hits = index.search(q, { limit: 5 }).map((i) => docs[Number(i)]);
  const relevant = docs.filter((d) => d.text.includes(q));
  const startsWith = relevant.filter((d) => d.text.startsWith(q)).length;
  console.log(`\n查询「${q}」：语料中包含它的文档 ${relevant.length} 篇`);
  console.log(`  其中以它开头的 ${startsWith} 篇（${((startsWith / relevant.length) * 100).toFixed(0)}%）`);
  console.log(`  默认配置命中 ${hits.length} 条，前 3 条开头:`);
  for (const h of hits.slice(0, 3)) console.log(`    ${h.text.slice(0, 26)}…`);
}
