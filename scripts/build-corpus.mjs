import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/**
 * 构建中文语料。
 *
 * 只用明确许可的文本：
 *  - Vue / React 中文文档：CC BY 4.0，转载需署名（已写入 meta.json）
 *
 * 输出 data/corpus.jsonl，每行一个文档段落：
 *  { id, source, path, title, text }
 *
 * 可复现性：按 commit SHA 下载 tarball，SHA 写进 meta.json。
 * 语料不会因为上游 main 分支变化而悄悄改变。
 */

const SOURCES = [
  {
    name: 'vue-docs-zh',
    repo: 'vuejs-translations/docs-zh-cn',
    branch: 'main',
    match: /\/src\/.+\.md$/,
    attribution: 'Vue.js 中文文档（vuejs-translations/docs-zh-cn）',
    license: 'CC BY 4.0',
  },
  {
    name: 'react-docs-zh',
    repo: 'reactjs/zh-hans.react.dev',
    branch: 'main',
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

/** 解析分支当前指向的 commit，用来锁定语料版本。
 *  已有 meta.json 时直接复用记录的 SHA，避免每次构建都打 GitHub API（未认证限流 60 次/小时）。
 *  需要更新语料时设 REFRESH_CORPUS=1。 */
async function resolveSha(source) {
  if (!process.env.REFRESH_CORPUS) {
    try {
      const prev = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8'));
      const hit = prev.sources?.find((s) => s.name === source.name);
      if (hit?.commit) return hit.commit;
    } catch {
      /* 首次运行没有 meta.json */
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${source.repo}/commits/${source.branch}`,
    {
      headers: {
        'user-agent': 'zh-search-bench/0.1',
        accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Error(`${source.repo} 取 commit 失败: HTTP ${res.status}`);
  const { sha } = await res.json();
  if (!sha) throw new Error(`${source.repo} 返回里没有 sha`);
  return sha;
}

async function ensureTarball(source, sha) {
  mkdirSync(CACHE, { recursive: true });
  const short = sha.slice(0, 12);
  const tgz = join(CACHE, `${source.name}-${short}.tgz`);
  if (existsSync(tgz)) return tgz;

  const url = `https://codeload.github.com/${source.repo}/tar.gz/${sha}`;
  process.stdout.write(`下载 ${source.name}@${short} … `);
  const res = await fetch(url, {
    headers: { 'user-agent': 'zh-search-bench/0.1' },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${source.name} 下载失败: HTTP ${res.status}`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  console.log(`${(statSync(tgz).size / 1048576).toFixed(1)}MB`);
  return tgz;
}

function ensureExtracted(source, tgz, sha) {
  const dir = join(CACHE, `${source.name}-${sha.slice(0, 12)}`);
  if (existsSync(dir)) return dir;
  mkdirSync(dir, { recursive: true });
  // Windows 10+ 自带 bsdtar
  execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' });
  return dir;
}

/** 去掉 markdown 语法，只留可读文本 */
function markdownToText(md) {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') // frontmatter
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

/**
 * 在 markdown 原文上按 h2 切小节。
 *
 * 必须在 markdownToText 之前做：那一步会把 `## ` 删掉，
 * 先转文本再按 `##` 切，永远切不出来。
 */
function splitRawSections(md) {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const parts = body.split(/^##\s+/m);
  const out = [];

  const head = parts.shift() ?? '';
  if (head.trim()) out.push({ heading: '', md: head });

  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl))
      .replace(/\s*\{#[^}]*\}\s*$/, '') // 去掉 VitePress 锚点 {#xxx}
      .trim();
    out.push({ heading, md: nl === -1 ? '' : part.slice(nl + 1) });
  }
  return out;
}

/** 按长度把一段文本切成不超过 MAX_DOC_CHARS 的块 */
function chunkText(text) {
  if (text.length <= MAX_DOC_CHARS) return text.length >= MIN_DOC_CHARS ? [text] : [];

  const chunks = [];
  let buf = '';
  for (const para of text.split(/\n+/)) {
    if ((buf + para).length > MAX_DOC_CHARS && buf.length >= MIN_DOC_CHARS) {
      chunks.push(buf.trim());
      buf = '';
    }
    buf += para + '\n';
  }
  if (buf.trim().length >= MIN_DOC_CHARS) chunks.push(buf.trim());
  return chunks;
}

const docs = [];
const seen = new Set();
const meta = { builtAt: new Date().toISOString(), sources: [] };

for (const source of SOURCES) {
  const sha = await resolveSha(source);
  const tgz = await ensureTarball(source, sha);
  const dir = ensureExtracted(source, tgz, sha);
  const files = walk(dir).filter((f) => source.match.test(f.replace(/\\/g, '/')));
  let before = docs.length;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const relPath = relative(dir, file).replace(/\\/g, '/').split('/').slice(1).join('/');
    const fileTitle = basename(file, '.md');

    for (const section of splitRawSections(raw)) {
      for (const chunk of chunkText(markdownToText(section.md))) {
        const text = chunk.replace(/\s+/g, ' ').trim();
        if (text.length < MIN_DOC_CHARS) continue;
        // 中文占比低于 20% 的段落（大量代码/API 表格）不进入语料
        const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjk / text.length < 0.2) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        docs.push({
          id: `${source.name}:${docs.length}`,
          source: source.name,
          path: relPath,
          title: section.heading || fileTitle,
          text,
        });
      }
    }
  }

  meta.sources.push({
    name: source.name,
    repo: source.repo,
    commit: sha,
    attribution: source.attribution,
    license: source.license,
    files: files.length,
    documents: docs.length - before,
  });
  console.log(`${source.name}@${sha.slice(0, 7)}: ${files.length} 个文件 → ${docs.length - before} 个文档`);
}

mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'corpus.jsonl'), docs.map((d) => JSON.stringify(d)).join('\n'), 'utf8');
meta.documents = docs.length;
meta.totalChars = docs.reduce((a, d) => a + d.text.length, 0);
writeFileSync(join(DATA, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

console.log(`\n合计 ${docs.length} 个文档，${(meta.totalChars / 10000).toFixed(1)} 万字`);
console.log(`平均每篇 ${Math.round(meta.totalChars / docs.length)} 字`);
