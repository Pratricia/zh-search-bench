import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/**
 * 构建中文语料。
 *
 * 只用明确许可的文本：
 *  - Vue / React 中文文档：CC BY 4.0，转载需署名（已在 README 与 meta.json 中标注）
 *
 * 输出 data/corpus.jsonl，每行一个文档段落：
 *  { id, source, path, title, text }
 */

const SOURCES = [
  {
    name: 'vue-docs-zh',
    url: 'https://codeload.github.com/vuejs-translations/docs-zh-cn/tar.gz/refs/heads/main',
    match: /\/src\/.+\.md$/,
    attribution: 'Vue.js 中文文档（vuejs-translations/docs-zh-cn）',
    license: 'CC BY 4.0',
  },
  {
    name: 'react-docs-zh',
    url: 'https://codeload.github.com/reactjs/zh-hans.react.dev/tar.gz/refs/heads/main',
    match: /\/src\/content\/.+\.md$/,
    attribution: 'React 中文文档（reactjs/zh-hans.react.dev）',
    license: 'CC BY 4.0',
  },
];

const CACHE = 'cache';
const DATA = 'data';
const MIN_DOC_CHARS = 60;
const MAX_DOC_CHARS = 900;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function download(source) {
  mkdirSync(CACHE, { recursive: true });
  const tgz = join(CACHE, `${source.name}.tgz`);
  if (existsSync(tgz)) return tgz;

  process.stdout.write(`下载 ${source.name} … `);
  const res = await fetch(source.url, { headers: { 'user-agent': 'zh-search-bench/0.1' } });
  if (!res.ok) throw new Error(`${source.name} 下载失败: HTTP ${res.status}`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  console.log(`${(statSync(tgz).size / 1048576).toFixed(1)}MB`);
  return tgz;
}

function extract(source, tgz) {
  const dir = join(CACHE, source.name);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  // Windows 10+ 自带 bsdtar
  execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' });
  return dir;
}

/** 去掉 markdown 语法，只留可读文本 */
function markdownToText(md) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '') // frontmatter
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/<[^>]+>/g, ' ') // HTML 标签
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接
    .replace(/`([^`]*)`/g, '$1') // 行内代码
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题符号
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s*[-*+]\s+/gm, '') // 列表符号
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 先按 ## 切小节，再按长度切块，避免单文档过长 */
function splitSections(text) {
  const parts = text.split(/\n(?=##\s)/);
  const chunks = [];
  for (const part of parts) {
    const lines = part.split('\n');
    const heading = (lines[0] || '').replace(/^#+\s*/, '').trim();
    const body = lines.slice(1).join('\n').trim();
    if (body.length <= MAX_DOC_CHARS) {
      if (body.length >= MIN_DOC_CHARS) chunks.push({ heading, body });
      continue;
    }
    let buf = '';
    for (const para of body.split(/\n+/)) {
      if ((buf + para).length > MAX_DOC_CHARS && buf.length >= MIN_DOC_CHARS) {
        chunks.push({ heading, body: buf.trim() });
        buf = '';
      }
      buf += para + '\n';
    }
    if (buf.trim().length >= MIN_DOC_CHARS) chunks.push({ heading, body: buf.trim() });
  }
  return chunks;
}

function hasChinese(s) {
  return /[\u4e00-\u9fff]/.test(s);
}

const docs = [];
const seen = new Set();
const meta = { builtAt: new Date().toISOString(), sources: [] };

for (const source of SOURCES) {
  const tgz = await download(source);
  const dir = extract(source, tgz);
  const files = walk(dir).filter((f) => source.match.test(f.replace(/\\/g, '/')));
  let before = docs.length;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const relPath = relative(dir, file).replace(/\\/g, '/').split('/').slice(1).join('/');
    const fileTitle = basename(file, '.md');
    for (const chunk of splitSections(markdownToText(raw))) {
      const text = chunk.body.replace(/\s+/g, ' ').trim();
      if (text.length < MIN_DOC_CHARS) continue;
      // 中文占比低于 20% 的段落（大量代码/API 表格）不进入语料
      const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      if (!hasChinese(text) || cjk / text.length < 0.2) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      docs.push({
        id: `${source.name}:${docs.length}`,
        source: source.name,
        path: relPath,
        title: chunk.heading || fileTitle,
        text,
      });
    }
  }

  meta.sources.push({
    name: source.name,
    url: source.url,
    attribution: source.attribution,
    license: source.license,
    files: files.length,
    documents: docs.length - before,
  });
  console.log(`${source.name}: ${files.length} 个文件 → ${docs.length - before} 个文档`);
}

mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'corpus.jsonl'), docs.map((d) => JSON.stringify(d)).join('\n'), 'utf8');
meta.documents = docs.length;
meta.totalChars = docs.reduce((a, d) => a + d.text.length, 0);
writeFileSync(join(DATA, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

console.log(`\n合计 ${docs.length} 个文档，${(meta.totalChars / 10000).toFixed(1)} 万字`);
console.log(`平均每篇 ${Math.round(meta.totalChars / docs.length)} 字`);
