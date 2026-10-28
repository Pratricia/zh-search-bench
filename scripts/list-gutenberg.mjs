const r = await fetch('https://www.gutenberg.org/browse/languages/zh', {
  headers: { 'user-agent': 'zh-search-bench/0.1 (research)' },
});
const html = await r.text();
const items = [...html.matchAll(/<a href="(\/ebooks\/\d+)"[^>]*>([^<]+)<\/a>/g)];
const seen = new Set();
const out = [];
for (const m of items) {
  if (seen.has(m[1])) continue;
  seen.add(m[1]);
  const title = m[2].trim();
  if (title) out.push(`${m[1]}\t${title}`);
}
const { writeFileSync } = await import('node:fs');
writeFileSync('data/_gutenberg-zh.tsv', out.join('\n'), 'utf8');

const wants = ['魯迅', '鲁迅', '老舍', '朱自清', '胡適', '胡适', '梁啟超', '梁启超', '郁達夫', '郁达夫', '蕭紅', '萧红', '徐志摩', '豐子愷'];
console.log('总计', out.length, '本');
for (const w of wants) {
  const hits = out.filter((l) => l.includes(w));
  console.log(w, '→', hits.length ? hits.map((h) => h.split('\t')[1]).join(' / ') : '无');
}
