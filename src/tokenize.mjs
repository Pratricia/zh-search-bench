/**
 * 中文二元组切分。
 *
 * 为什么是二元组：中文没有空格，而所有 JS 搜索库的分词器都按空白/标点切，
 * 于是一整句中文会变成「一个词」。把连续汉字切成两两相邻的二元组，
 * 既不需要词典，又能让「检索」这种两字查询命中。
 */

const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;

export function segment(text) {
  return text
    .replace(CJK_RUN, (run) => {
      if (run.length === 1) return ` ${run} `;
      const grams = [];
      for (let i = 0; i < run.length - 1; i++) grams.push(run.slice(i, i + 2));
      return ` ${grams.join(' ')} `;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 切好的 token 列表，供自定义 tokenizer 使用。纯标点不算 token。 */
const MEANINGFUL = /[\p{L}\p{N}]/u;

export function tokens(text) {
  return segment(text)
    .split(' ')
    .filter((t) => t && MEANINGFUL.test(t));
}
