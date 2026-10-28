import { segment, tokens } from './tokenize.mjs';

/**
 * 统一的适配器接口：
 *   build(docs) -> { search(query, k): string[], size(): number|null }
 * docs: [{ id: string, text: string }]
 *
 * 每个库给两组配置：
 *   default —— 照 README 直接用的写法
 *   tuned   —— 只做「让它能正确索引中文」的最小改动
 * 用来回答：加几行代码到底能提升多少。
 */

/** lunr 的 trimmer 用 \W 判断边界，而 JS 的 \W 把汉字当作非单词字符，会把中文词裁空 */
function unicodeTrimmer(token) {
  const s = token
    .toString()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
  if (!s) return null;
  return token.update(() => s);
}

/** 注册进 pipeline，否则 lunr 会在序列化时告警 */
if (typeof unicodeTrimmer === 'function') {
  // 延迟注册：lunr 在首次使用时才加载
  const register = async () => {
    const lunr = (await import('lunr')).default;
    if (!lunr.Pipeline.registeredFunctions?.unicodeTrimmer) {
      lunr.Pipeline.registerFunction(unicodeTrimmer, 'unicodeTrimmer');
    }
  };
  await register();
}

export const ADAPTERS = [
  // ─────────────── 自建基线 ───────────────
  {
    id: 'baseline-bigram',
    label: '自建二元组倒排（本文基线）',
    async build(docs) {
      const postings = new Map();
      const lengths = [];
      docs.forEach((doc, i) => {
        const toks = tokens(doc.text);
        lengths.push(toks.length || 1);
        for (const t of toks) {
          let m = postings.get(t);
          if (!m) postings.set(t, (m = new Map()));
          m.set(i, (m.get(i) || 0) + 1);
        }
      });
      return {
        search(query, k) {
          const qs = tokens(query);
          if (!qs.length) return [];
          const scores = new Map();
          for (const t of qs) {
            const m = postings.get(t);
            if (!m) continue;
            const idf = Math.log(1 + docs.length / m.size);
            for (const [i, tf] of m) {
              scores.set(i, (scores.get(i) || 0) + idf * (tf / lengths[i]) * 100);
            }
          }
          return [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, k)
            .map(([i]) => docs[i].id);
        },
        size: () => JSON.stringify([...postings].map(([t, m]) => [t, m.size])).length,
      };
    },
  },

  // ─────────────── FlexSearch ───────────────
  {
    id: 'flexsearch/default',
    label: 'FlexSearch（默认）',
    async build(docs) {
      const { Index } = await import('flexsearch');
      const index = new Index();
      docs.forEach((d, i) => index.add(i, d.text));
      return {
        search(query, k) {
          return index.search(query, { limit: k }).map((i) => docs[Number(i)].id);
        },
        size: () => null,
      };
    },
  },
  {
    id: 'flexsearch/cjk-charset',
    label: 'FlexSearch（开启内置 CJK 编码器）',
    async build(docs) {
      const { Index, Charset } = await import('flexsearch');
      const index = new Index({ encoder: Charset.CJK });
      docs.forEach((d, i) => index.add(i, d.text));
      return {
        search(query, k) {
          return index.search(query, { limit: k }).map((i) => docs[Number(i)].id);
        },
        size: () => null,
      };
    },
  },
  {
    id: 'flexsearch/bigram',
    label: 'FlexSearch + 二元组预处理',
    async build(docs) {
      const { Index } = await import('flexsearch');
      const index = new Index({ tokenize: 'strict' });
      docs.forEach((d, i) => index.add(i, segment(d.text)));
      return {
        search(query, k) {
          return index.search(segment(query), { limit: k }).map((i) => docs[Number(i)].id);
        },
        size: () => null,
      };
    },
  },

  // ─────────────── MiniSearch ───────────────
  {
    id: 'minisearch/default',
    label: 'MiniSearch（默认）',
    async build(docs) {
      const MiniSearch = (await import('minisearch')).default;
      const mini = new MiniSearch({ fields: ['text'], storeFields: ['id'] });
      mini.addAll(docs.map((d) => ({ id: d.id, text: d.text })));
      return {
        search(query, k) {
          return mini.search(query, { limit: k }).map((r) => r.id);
        },
        size: () => JSON.stringify(mini).length,
      };
    },
  },
  {
    id: 'minisearch/bigram',
    label: 'MiniSearch + 二元组分词',
    async build(docs) {
      const MiniSearch = (await import('minisearch')).default;
      const mini = new MiniSearch({
        fields: ['text'],
        storeFields: ['id'],
        tokenize: (text) => tokens(text),
        searchOptions: { tokenize: (text) => tokens(text) },
      });
      mini.addAll(docs.map((d) => ({ id: d.id, text: d.text })));
      return {
        search(query, k) {
          return mini.search(query, { limit: k }).map((r) => r.id);
        },
        size: () => JSON.stringify(mini).length,
      };
    },
  },

  // ─────────────── Lunr ───────────────
  {
    id: 'lunr/default',
    label: 'Lunr（默认）',
    async build(docs) {
      const lunr = (await import('lunr')).default;
      const index = lunr(function () {
        this.ref('rid');
        this.field('text');
        docs.forEach((d, i) => this.add({ rid: i, text: d.text }));
      });
      return {
        search(query, k) {
          try {
            return index.search(query).slice(0, k).map((r) => docs[Number(r.ref)].id);
          } catch {
            return [];
          }
        },
        size: () => null,
      };
    },
  },
  {
    id: 'lunr/unicode-trimmer',
    label: 'Lunr（只替换 trimmer 的 \\W）',
    async build(docs) {
      const lunr = (await import('lunr')).default;
      const index = lunr(function () {
        this.ref('rid');
        this.field('text');
        for (const p of [this.pipeline, this.searchPipeline]) {
          p.reset();
          p.add(unicodeTrimmer, lunr.stopWordFilter, lunr.stemmer);
        }
        docs.forEach((d, i) => this.add({ rid: i, text: d.text }));
      });
      return {
        search(query, k) {
          try {
            return index.search(query).slice(0, k).map((r) => docs[Number(r.ref)].id);
          } catch {
            return [];
          }
        },
        size: () => null,
      };
    },
  },
  {
    id: 'lunr/bigram',
    label: 'Lunr + trimmer 修复 + 二元组',
    async build(docs) {
      const lunr = (await import('lunr')).default;
      const index = lunr(function () {
        this.ref('rid');
        this.field('text');
        for (const p of [this.pipeline, this.searchPipeline]) {
          p.reset();
          p.add(unicodeTrimmer, lunr.stopWordFilter);
        }
        docs.forEach((d, i) => this.add({ rid: i, text: segment(d.text) }));
      });
      return {
        search(query, k) {
          try {
            return index.search(segment(query)).slice(0, k).map((r) => docs[Number(r.ref)].id);
          } catch {
            return [];
          }
        },
        size: () => null,
      };
    },
  },

  // ─────────────── Fuse.js ───────────────
  {
    id: 'fuse/default',
    label: 'Fuse.js（默认阈值 0.6）',
    async build(docs) {
      const Fuse = (await import('fuse.js')).default;
      const fuse = new Fuse(docs.map((d) => ({ id: d.id, text: d.text })), { keys: ['text'] });
      return {
        search(query, k) {
          return fuse.search(query, { limit: k }).map((r) => r.item.id);
        },
        size: () => null,
      };
    },
  },
  {
    id: 'fuse/exact',
    label: 'Fuse.js（阈值 0，忽略位置）',
    async build(docs) {
      const Fuse = (await import('fuse.js')).default;
      const fuse = new Fuse(
        docs.map((d) => ({ id: d.id, text: d.text })),
        { keys: ['text'], threshold: 0, ignoreLocation: true },
      );
      return {
        search(query, k) {
          return fuse.search(query, { limit: k }).map((r) => r.item.id);
        },
        size: () => null,
      };
    },
  },

  // ─────────────── Orama ───────────────
  {
    id: 'orama/default',
    label: 'Orama（默认）',
    async build(docs) {
      const { create, insertMultiple, search } = await import('@orama/orama');
      const db = await create({ schema: { id: 'string', text: 'string' } });
      await insertMultiple(db, docs.map((d) => ({ id: d.id, text: d.text })));
      return {
        async search(query, k) {
          const r = await search(db, { term: query, limit: k, properties: ['text'] });
          return r.hits.map((h) => h.document.id);
        },
        size: () => null,
      };
    },
  },
  {
    id: 'orama/custom-tokenizer',
    label: 'Orama（换掉会吞中文的分词器）',
    async build(docs) {
      const { create, insertMultiple, search } = await import('@orama/orama');
      const bigramTokenize = (raw) => tokens(raw);
      const db = await create({
        schema: { id: 'string', text: 'string' },
        components: {
          tokenizer: {
            tokenize: bigramTokenize,
            language: 'chinese',
            normalizationCache: new Map(),
          },
        },
      });
      await insertMultiple(db, docs.map((d) => ({ id: d.id, text: d.text })));
      return {
        async search(query, k) {
          const r = await search(db, { term: query, limit: k, properties: ['text'] });
          return r.hits.map((h) => h.document.id);
        },
        size: () => null,
      };
    },
  },
];
