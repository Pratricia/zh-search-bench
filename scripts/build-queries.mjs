import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * 生成查询集与标准答案。
 *
 * 标注方法：查询 q 对文档 d 相关 ⟺ d.text.includes(q)
 * 直接对原文做子串判定，不做大小写/空白归一化——归一化会把
 * 「响应 式」也算成包含「响应式」，而任何按字面建索引的引擎都
 * 不可能命中这种查询，等于给所有引擎塞进一个必失项。
 * 它测的是「字面命中能力」，也就是分词失败时最先崩掉的那一环。
 */

const PARTICLES = /^[的了是在和与就都也而且被把对从到为以于之其这那有着过吗呢吧啊]/;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261028);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const corpusRaw = readFileSync('data/corpus.jsonl', 'utf8');
const docs = corpusRaw
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

/** 语料指纹：语料内容一变，查询就必须重生成 */
const corpusHash = createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16);

/**
 * 统计某个查询在多少篇文档里**原文**出现。
 *
 * 刻意不做 normalize：这份基准测的是字面命中。如果文档里是「响应 式」
 * （中间有空格），而查询是「响应式」，那它就不算相关——任何按字面
 * 建索引的引擎都不可能命中，把它算进标准答案只会给所有引擎塞进
 * 一个必失项。
 */
function docFreq(q) {
  const hits = [];
  for (const doc of docs) if (doc.text.includes(q)) hits.push(doc.id);
  return hits;
}

/** 从文档里随机截一段纯中文，长度 n */
function randomSpan(text, n) {
  const runs = [...text.matchAll(/[\u4e00-\u9fff]{2,}/g)];
  if (!runs.length) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const run = pick(runs);
    if (run[0].length < n) continue;
    const start = Math.floor(rand() * (run[0].length - n + 1));
    const span = run[0].slice(start, start + n);
    if (PARTICLES.test(span)) continue; // 别拿“的了是”这种片段当查询
    return span;
  }
  return null;
}

function buildSet(name, length, wanted, maxDf) {
  const queries = [];
  const seen = new Set();
  let guard = 0;
  while (queries.length < wanted && guard++ < wanted * 40) {
    const doc = pick(docs);
    const span = randomSpan(doc.text, length);
    if (!span || seen.has(span)) continue;
    seen.add(span);
    const relevant = docFreq(span);
    if (relevant.length === 0 || relevant.length > maxDf) continue;
    queries.push({ q: span, set: name, df: relevant.length, relevant });
  }
  return queries;
}

/** 人工挑的真实查询：中文里用户真会这么搜，而且语料里确实有原句 */
const HANDWRITTEN = [
  '响应式', '组合式函数', '生命周期', '虚拟 DOM', '渲染函数', '模板编译', '状态管理',
  '动态组件', '异步组件', '插槽', '自定义指令', '过渡动画', '跨组件通信', '依赖注入',
  '服务端渲染', '水合', '路由守卫', '懒加载', '副作用', '计算属性', '侦听器', '事件总线',
  '受控组件', '非受控组件', '错误边界', '上下文', '调和', '批处理', '事件委托', '表单提交',
];

const sets = {
  'zh-1char': buildSet('zh-1char', 1, 100, 60),
  'zh-2char': buildSet('zh-2char', 2, 200, 40),
  'zh-3char': buildSet('zh-3char', 3, 150, 30),
  'zh-4char': buildSet('zh-4char', 4, 150, 20),
  'zh-phrase': buildSet('zh-phrase', 6, 100, 10),
};

// 真实查询：只保留语料里确实存在的
const handwritten = [];
for (const q of HANDWRITTEN) {
  const relevant = docFreq(q);
  if (relevant.length > 0) handwritten.push({ q, set: 'handwritten', df: relevant.length, relevant });
}

const all = [...Object.values(sets).flat(), ...handwritten];
const bySet = Object.fromEntries(
  Object.entries({ ...sets, handwritten }).map(([name, list]) => [
    name,
    { count: list.length, avgDf: +(list.reduce((a, x) => a + x.df, 0) / (list.length || 1)).toFixed(2) },
  ]),
);

writeFileSync(
  'data/queries.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corpusHash,
      corpusDocs: docs.length,
      sets: bySet,
      queries: all,
    },
    null,
    0,
  ),
  'utf8',
);

console.log(`语料 ${docs.length} 篇，生成 ${all.length} 条查询`);
for (const [name, s] of Object.entries(bySet)) console.log(`  ${name.padEnd(12)} ${String(s.count).padStart(4)} 条，平均命中 ${s.avgDf} 篇`);
console.log('\n示例：');
for (const q of all.slice(0, 6)) console.log(`  "${q.q}" → ${q.df} 篇`);
