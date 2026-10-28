import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lunr = (await import('lunr')).default;
require('lunr-languages/lunr.stemmer.support')(lunr);
require('lunr-languages/lunr.zh')(lunr);

const doc = 'Vue 的响应式系统基于 Proxy 实现，依赖收集发生在渲染时。';
const query = '响应式';

console.log('lunr 版本:', lunr.version);
console.log('lunr.zh.tokenizer(doc)   =', lunr.zh.tokenizer(doc).map((t) => t.toString()));
console.log('lunr.zh.tokenizer(query) =', lunr.zh.tokenizer(query).map((t) => t.toString()));

function build(configure) {
  return lunr(function () {
    configure.call(this);
    this.ref('rid');
    this.field('text');
    this.add({ rid: 0, text: doc });
  });
}

function report(name, configure) {
  const index = build(configure);
  let hits = 0;
  try {
    hits = index.search(query).length;
  } catch (e) {
    hits = `抛错: ${e.message}`;
  }
  // 看看 query 在 searchPipeline 里被处理成什么
  let qTokens = [];
  try {
    qTokens = index.searchPipeline
      .run(lunr.tokenizer(query).slice())
      .map((t) => t.toString())
      .filter(Boolean);
  } catch {
    qTokens = ['<pipeline 执行失败>'];
  }
  console.log(`\n${name}`);
  console.log(`  hit = ${hits}`);
  console.log(`  查询经 searchPipeline 后 = ${JSON.stringify(qTokens)}`);
}

// A：官方文档写法，只 this.use(lunr.zh)
report('A. this.use(lunr.zh)（官方写法）', function () {
  this.use(lunr.zh);
});

// B：额外把 searchPipeline 也换掉
report('B. this.use(lunr.zh) + 重设 searchPipeline', function () {
  this.use(lunr.zh);
  this.searchPipeline.reset();
  this.searchPipeline.add(lunr.zh.trimmer, lunr.zh.stopWordFilter, lunr.zh.stemmer);
});

// C：连 tokenizer 一起显式覆盖（lunr 2.x 可能不读 builder.tokenizer）
report('C. B + 显式覆盖 builder.tokenizer', function () {
  this.use(lunr.zh);
  this.tokenizer = lunr.zh.tokenizer;
  this.searchPipeline.reset();
  this.searchPipeline.add(lunr.zh.trimmer, lunr.zh.stopWordFilter, lunr.zh.stemmer);
});

// D：查询侧自己先切好词，再交给 lunr（绕过 QueryLexer 只按空白切的问题）
{
  const index = build(function () {
    this.use(lunr.zh);
  });
  const q = lunr.zh
    .tokenizer(query)
    .map((t) => t.toString())
    .join(' ');
  console.log('\nD. 官方插件 + 查询侧手动切词');
  console.log(`  查询字符串 = ${JSON.stringify(q)}`);
  console.log(`  hit = ${index.search(q).length}`);
}
