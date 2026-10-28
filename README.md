# zh-search-bench

**JavaScript 全文搜索库在中文上表现如何？有人写过「你会发现中文不行」，但没人给出数字。这是一份可复现的测量——而且它顺带证明了：问题不在库的能力，在默认配置。**

一句话结论：这些库在中文上默认基本不可用——不是效果差，是**静默失效**。Lunr 默认 `hit@10` 是 **0.1%**，Orama 是 **0%**，两者都不报任何错。但 Lunr 按官方方案修好之后是 **92%**，全场第一。

📄 完整分析见 [REPORT.md](REPORT.md)

## 先确认这不是集成错误

一个库、一篇文档、查询就是原文里的连续子串：

| 配置 | 英文 | 中文 | 日文 | 韩文 | 阿拉伯文 |
|---|:---:|:---:|:---:|:---:|:---:|
| Lunr（默认） | ✅ | ❌ | ❌ | ❌ | ❌ |
| Lunr + 官方中文插件 | — | ❌ | — | — | — |
| Orama（默认） | ✅ | ❌ | ❌ | ❌ | ❌ |
| Orama + 官方中文分词器 | — | ✅ | — | — | — |
| MiniSearch（默认） | ✅ | ❌ | ❌ | ✅ | ✅ |
| FlexSearch（默认） | ✅ | ❌ | ❌ | ✅ | ✅ |

复现：`npm run verify`。失败边界正好落在**无空格语言**上；Lunr 和 Orama 连有空格的非拉丁语言也挂，因为它们的问题更底层。

## 结果

| 配置 | hit@10 | P@10 | 查询 p50 | 说明 |
|---|---:|---:|---:|---|
| Fuse.js（阈值 0） | 100% | 100% | 29.8ms | 暴力子串，召回上限，慢 3000 倍 |
| Orama + 二元组 | 99.3% | 59.2% | 0.08ms | |
| **Lunr + 官方中文插件** | **92.0%** | 43.7% | 0.83ms | 官方插件 + 查询切词，全场第一 |
| FlexSearch + 二元组 | 86.8% | **79.8%** | **0.01ms** | 综合最优 |
| MiniSearch + 二元组 | 86.5% | 47.1% | 0.07ms | |
| FlexSearch + 内置 CJK | 70.6% | 29.8% | 0.02ms | 单字 100%、多字掉到 55% |
| Orama + 官方中文分词器 | 48.8% | 23.9% | 0.53ms | 词典分词，任意子串失效 |
| FlexSearch（默认） | 15.5% | 15.5% | 0.002ms | |
| Lunr（默认） | 0.1% | 0% | 0.005ms | `\W` 把汉字裁成空串 |
| Orama（默认） | 0% | 0% | 0.003ms | 分词器吞掉中文 |

## 三个根因

**Lunr**：默认 pipeline 的 `trimmer` 用 `\W` 判断词边界。JS 里没有 `u` 标志时 `\W = [^A-Za-z0-9_]`，汉字全是「非单词字符」，每个中文词都被裁成空串后丢弃。源码注释自己承认了这个限制。

**Orama**：默认 splitter 是 `/[^A-Za-zàèéìòóù0-9_'-]+/`，拉丁字母以外一律当分隔符。`tokenize('响应式测试')` 直接返回 `[]`。

**Lunr 官方中文插件**：只修了索引端（切二元组），查询端的 `QueryLexer.termSeparator` 仍然只按空白切，整句被当成一个词。装了插件还是 0，必须自己把查询也切一遍。

三者都不报错、不告警、索引照常构建、查询照常返回空结果。

## 方法

- **语料**：1133 篇中文技术文档，84.8 万字（Vue / React 官方中文文档）
- **查询**：727 条（单字 / 两字 / 三字 / 四字 / 六字短语 / 人工真实查询）
- **标注**：`q` 对 `d` 相关 ⟺ `d` 原文包含 `q`。子串判定，零主观，可机器复现
- **指标**：hit@10、P@10、R@10、MRR、查询延迟、构建耗时、索引体积

标注用子串判定意味着**这份基准测的是「字面命中」，不是语义检索**。这是个刻意的取舍：分词失败是这些库在中文上最先崩的一环，把它隔离出来才能定位问题。

## 复现

```bash
npm install
npm run corpus    # 下载语料（Node 22.15+，用 --use-system-ca 处理证书）
npm run queries   # 生成查询集与标准答案（固定随机种子，结果确定）
npm run verify    # 最小复现：一个库、一篇文档、一句原文查询
npm run bench     # 跑全部配置，输出 results/results.json
```

冒烟测试（只跑前 N 条查询）：

```bash
BENCH_LIMIT=60 npm run bench
```

## 语料许可

- **Vue.js 中文文档**（[vuejs-translations/docs-zh-cn](https://github.com/vuejs-translations/docs-zh-cn)）— CC BY 4.0
- **React 中文文档**（[reactjs/zh-hans.react.dev](https://github.com/reactjs/zh-hans.react.dev)）— CC BY 4.0

语料不入库，由 `npm run corpus` 现场下载，署名信息写入 `data/meta.json`。

## 目录

```
scripts/build-corpus.mjs     下载 + 清洗 + 切分语料
scripts/build-queries.mjs    生成查询与标准答案
scripts/verify-minimal.mjs   最小复现（单文档、单查询、多语言）
scripts/run.mjs              跑基准，输出 results/results.json
src/tokenize.mjs             中文二元组切分
src/adapters.mjs             15 种配置的适配器（默认 / 修复 / 官方）
REPORT.md                    完整分析与结论
```

## 已知局限

1. 语料是技术文档，新闻 / 口语 / 古典中文未覆盖
2. 查询由语料截取生成，真实用户的错字、同义词、拼音输入未覆盖
3. 不测语义相关性
4. 单机单次测量，延迟看量级不看小数
5. 二元组方案不处理繁简混用
6. `Intl.Segmenter` 的分词结果依赖 Node 的 ICU 版本
