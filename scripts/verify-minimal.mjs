import { createRequire } from 'node:module';

/**
 * 最小复现：一个库、一篇文档、查询就是原文里的子串。
 *
 * 目的：排除「是我们集成写错了」的可能。
 * 如果连「文档里有什么，就搜什么」都搜不到，那问题在库，不在调用方。
 *
 * 同时测「官方推荐配置」，用来区分两件事：
 *   - 默认配置不可用
 *   - 这个库根本做不了
 */

const require = createRequire(import.meta.url);

const CASES = [
  { lang: 'en', doc: 'The quick brown fox jumps over the lazy dog.', query: 'brown fox' },
  { lang: 'zh', doc: 'Vue 的响应式系统基于 Proxy 实现，依赖收集发生在渲染时。', query: '响应式' },
  { lang: 'ja', doc: '本日の会議では全文検索の実装方針を決めます。', query: '全文検索' },
  { lang: 'ko', doc: '오늘 회의에서는 전문 검색 구현 방식을 정합니다.', query: '전문 검색' },
  { lang: 'ar', doc: 'يجتمع الفريق اليوم لمناقشة البحث النصي الكامل.', query: 'النصي' },
];

const lunr = (await import('lunr')).default;
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.zh')(lunr);

const ENGINES = [
  {
    id: 'Lunr（默认）',
    async build(doc) {
      const index = lunr(function () {
        this.ref('rid');
        this.field('text');
        this.add({ rid: 0, text: doc });
      });
      return (q) => {
        try {
          return index.search(q).length;
        } catch {
          return 0;
        }
      };
    },
  },
  {
    id: 'Lunr + lunr-languages 中文插件（官方）',
    lang: 'zh',
    async build(doc) {
      const index = lunr(function () {
        this.use(lunr.zh);
        this.ref('rid');
        this.field('text');
        this.add({ rid: 0, text: doc });
      });
      return (q) => {
        try {
          return index.search(q).length;
        } catch {
          return 0;
        }
      };
    },
  },
  {
    id: 'Orama（默认）',
    async build(doc) {
      const { create, insert, search } = await import('@orama/orama');
      const db = await create({ schema: { text: 'string' } });
      await insert(db, { id: 'doc', text: doc });
      return async (q) => (await search(db, { term: q, limit: 5 })).hits.length;
    },
  },
  {
    id: 'Orama + @orama/tokenizers 中文（官方）',
    lang: 'zh',
    async build(doc) {
      const { create, insert, search } = await import('@orama/orama');
      const { createTokenizer } = await import('@orama/tokenizers/mandarin');
      const db = await create({
        schema: { text: 'string' },
        components: { tokenizer: createTokenizer() },
      });
      await insert(db, { id: 'doc', text: doc });
      return async (q) => (await search(db, { term: q, limit: 5 })).hits.length;
    },
  },
  {
    id: 'Orama + @orama/tokenizers 日文（官方）',
    lang: 'ja',
    async build(doc) {
      const { create, insert, search } = await import('@orama/orama');
      const { createTokenizer } = await import('@orama/tokenizers/japanese');
      const db = await create({
        schema: { text: 'string' },
        components: { tokenizer: createTokenizer() },
      });
      await insert(db, { id: 'doc', text: doc });
      return async (q) => (await search(db, { term: q, limit: 5 })).hits.length;
    },
  },
  {
    id: 'MiniSearch（默认）',
    async build(doc) {
      const MiniSearch = (await import('minisearch')).default;
      const mini = new MiniSearch({ fields: ['text'] });
      mini.add({ id: 'doc', text: doc });
      return (q) => mini.search(q).length;
    },
  },
  {
    id: 'FlexSearch（默认）',
    async build(doc) {
      const { Index } = await import('flexsearch');
      const index = new Index();
      index.add(0, doc);
      return (q) => index.search(q, { limit: 5 }).length;
    },
  },
];

const cols = CASES.map((c) => c.lang);
const rows = [];

console.log('单篇文档，查询 = 原文中的连续子串\n');
for (const engine of ENGINES) {
  const row = { id: engine.id, cells: {} };
  for (const c of CASES) {
    if (engine.lang && engine.lang !== c.lang) {
      row.cells[c.lang] = '—';
      continue;
    }
    const search = await engine.build(c.doc);
    const hits = await search(c.query);
    row.cells[c.lang] = hits > 0 ? `✅ ${hits}` : '❌ 0';
  }
  rows.push(row);
}

const pad = (s, n) => {
  // 中文按 2 个字符宽度算，简单对齐
  const w = [...String(s)].reduce((a, ch) => a + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

console.log(pad('配置', 40) + cols.map((c) => pad(c, 7)).join(''));
for (const r of rows) {
  console.log(pad(r.id, 40) + cols.map((c) => pad(r.cells[c], 7)).join(''));
}

// ── 诊断信息：为什么是 0 ──
console.log('\n诊断：');
const zh = CASES.find((c) => c.lang === 'zh');

const tok = lunr.tokenizer(zh.doc);
const piped = lunr.Pipeline.load(['trimmer', 'stopWordFilter', 'stemmer']).run(tok.slice());
console.log(`  lunr.tokenizer("${zh.doc.slice(0, 6)}…") → ${JSON.stringify(tok.map((t) => t.toString()))}`);
console.log(`  过完默认 pipeline               → ${JSON.stringify(piped.map((t) => t.toString()))}`);

const { create } = await import('@orama/orama');
const db = await create({ schema: { text: 'string' } });
console.log(`  orama 默认 tokenize("${zh.doc.slice(0, 6)}…") → ${JSON.stringify(db.tokenizer.tokenize(zh.doc))}`);

console.log('\n注明：— 表示该配置与语言不匹配，未测。');
