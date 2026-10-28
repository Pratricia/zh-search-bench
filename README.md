# zh-search-bench

**JavaScript 全文搜索库在中文上表现如何？有人写过「你会发现中文不行」，但没人给出数字。这是一份可复现的测量。**

一句话结论：这些库在中文上默认基本不可用——不是效果差，是**静默失效**。Lunr 和 Orama 在纯中文语料上 `hit@10` 分别是 **0.1%** 和 **0%**，而且不报任何错。

📄 完整分析见 [REPORT.md](REPORT.md)

## 数据速览

| 配置 | hit@10 | P@10 | 查询 p50 | 说明 |
|---|---:|---:|---:|---|
| Fuse.js（阈值 0） | 100% | 100% | 30.8ms | 暴力子串，召回上限，但慢 3000 倍 |
| Orama + 换分词器 | 99.3% | 59.2% | 0.08ms | 默认分词器对纯中文返回 `[]` |
| FlexSearch + 二元组 | 86.8% | 79.8% | 0.01ms | 性价比最高 |
| FlexSearch + 内置 CJK | 70.6% | 29.8% | 0.02ms | 单字 100%、多字掉到 55% |
| FlexSearch（默认） | 15.5% | 15.5% | 0.003ms | |
| Lunr（默认） | 0.1% | 0% | 0.006ms | `\W` 把汉字裁成空串 |
| Orama（默认） | 0% | 0% | 0.004ms | 分词器吞掉中文 |

## 两个值得单独说的 bug 级行为

**Lunr**：默认 pipeline 的 `trimmer` 用 `\W` 判断词边界。JS 里没有 `u` 标志时 `\W = [^A-Za-z0-9_]`，汉字全是「非单词字符」，于是每个中文词都被裁成空串后丢弃。1133 篇中文文档，倒排表里一个中文词都没有。

**Orama**：`tokenize('响应式测试')` 直接返回 `[]`。

两者都不报错、不告警，索引照常构建，查询照常返回空结果。

## 方法

- **语料**：1133 篇中文技术文档，84.8 万字（Vue / React 官方中文文档）
- **查询**：727 条（单字 / 两字 / 三字 / 四字 / 六字短语 / 人工真实查询）
- **标注**：`q` 对 `d` 相关 ⟺ `d` 原文包含 `q`。子串判定，零主观，可机器复现
- **指标**：hit@10、P@10、R@10、MRR、查询延迟、构建耗时、索引体积

标注用子串判定意味着**这份基准测的是「字面命中」，不是语义检索**。这是个刻意的取舍：分词失败是这些库在中文上最先崩的一环，把它隔离出来才能定位问题。

## 复现

```bash
npm install
npm run corpus    # 下载语料（需要 Node 22.15+，用 --use-system-ca 处理证书）
npm run queries   # 生成查询集与标准答案（固定随机种子，结果确定）
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
scripts/build-corpus.mjs   下载 + 清洗 + 切分语料
scripts/build-queries.mjs  生成查询与标准答案
scripts/run.mjs            跑基准，输出 results/results.json
src/tokenize.mjs           中文二元组切分
src/adapters.mjs           各库适配器（默认配置 + 修复配置）
REPORT.md                  完整分析与结论
```

## 已知局限

1. 语料是技术文档，新闻 / 口语 / 古典中文未覆盖
2. 查询由语料截取生成，真实用户的错字、同义词、拼音输入未覆盖
3. 不测语义相关性
4. 单机单次测量，延迟看量级不看小数
5. 二元组方案不处理繁简混用
