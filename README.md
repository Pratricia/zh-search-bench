# zh-search-bench

[![ci](https://github.com/Pratricia/zh-search-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/Pratricia/zh-search-bench/actions/workflows/ci.yml)

JavaScript 全文搜索库的中文召回率基准：5 个库、15 种配置、1740 篇文档、727 条查询，语料与标注全部可复现。

项目不提供新的搜索库，也不提供分词器，只做测量：**这些库在中文上到底能搜到多少，默认配置和官方修复路径差多远。**

## 测什么

| | |
|---|---|
| 语料 | 1740 篇中文文档，81.5 万字（Vue / React 官方中文文档，CC BY 4.0，按 commit 锁定） |
| 查询 | 727 条：单字 100 / 两字 200 / 三字 150 / 四字 150 / 六字短语 100 / 人工 27 |
| 标注 | 查询 `q` 对文档 `d` 相关 ⟺ `d.text.includes(q)`，原文子串判定，零主观、可机器复现 |
| 指标 | hit@10、P@10、R@10、MRR、查询延迟、构建耗时 |
| 被测 | FlexSearch 0.8 / MiniSearch 7 / Lunr 2.3 / Fuse.js 7 / Orama 3 |

标注用子串判定，测的是**字面命中**，不是语义检索。这是刻意的取舍：分词失败是这些库在中文上最先崩的一环，把它隔离出来才能定位问题。

## 结果

按 727 条查询平均，k = 10。「两字以上」是去掉 100 条单字查询后的 hit@10。

| 配置 | hit@10 | P@10 | 两字以上 |
|---|---:|---:|---:|
| Fuse.js（阈值 0，校验基线） | 100% | 52.2% | 100% |
| Orama + 二元组 | 97.1% | 47.5% | 96.8% |
| Lunr + 官方中文插件 | 90.6% | 39.2% | 98.7% |
| FlexSearch + 二元组 | 86.4% | 38.8% | 99.7% |
| MiniSearch + 二元组 | 86.1% | 38.8% | 99.5% |
| Lunr + 修复 trimmer + 二元组 | 85.6% | 38.1% | 98.9% |
| 自建二元组倒排 | 77.0% | 30.1% | 89.0% |
| FlexSearch + 内置 CJK 编码器 | 71.7% | 28.0% | 67.1% |
| Orama + 官方中文分词器 | 52.4% | 21.0% | 47.8% |
| Fuse.js（默认 0.6） | 51.7% | 15.8% | 45.3% |
| FlexSearch（默认） | 16.5% | 4.8% | 18.7% |
| MiniSearch（默认） | 16.4% | 4.8% | 18.7% |
| Lunr（只修 trimmer） | 10.7% | 2.9% | 12.1% |
| Lunr（默认） | 0.1% | 0% | 0.2% |
| Orama（默认） | 0% | 0% | 0% |

三个结论：

- **默认配置基本不可用。** Lunr 0.1%、Orama 0%，且都不报错；FlexSearch / MiniSearch 也只有 16%。
- **官方修复路径有效。** Lunr 官方中文插件 90.6%，Orama 官方中文分词器 52.4%，自建二元组 97.1%。
- **两字以上查询，二元组方案 99% 以上。** 总分差距几乎全部来自单字：100 条单字里有 99 条在二元组索引中结构上不可能命中。

Fuse.js 阈值 0 那一行是**校验基线**，不是推荐用法：它等价于标注函数，用来确认评测流程没写错。

## 快速开始

```bash
npm install
npm run corpus    # 按 commit SHA 下载语料
npm run queries   # 生成查询与标准答案（固定随机种子）
npm run check     # 校验标注自洽、查询未过期
npm run verify    # 最小复现：一个库、一篇文档、一句原文查询
npm run bench     # 跑全部配置，输出 results/results.json
```

冒烟测试（按查询集分层抽样，不会只跑到单字）：

```bash
BENCH_LIMIT=60 npm run bench
```

`results/results.json` 包含每个配置、每个查询集的明细，以及语料指纹、依赖版本与运行环境。

## 项目结构

```
scripts/build-corpus.mjs     下载 + 清洗 + 按小节切分语料（锁定 commit）
scripts/build-queries.mjs    生成查询与标准答案
scripts/check-data.mjs       数据体检：标注自洽、查询未过期
scripts/check-docs.mjs       核对文档数字与结果一致
scripts/verify-minimal.mjs   最小复现（单文档、单查询、多语言）
scripts/run.mjs              跑基准，输出 results/results.json
src/tokenize.mjs             中文二元组切分
src/adapters.mjs             15 种配置的适配器（默认 / 修复 / 官方）
REPORT.md                    完整分析：根因、方法、逐项数据
```

## 数据与许可

- **Vue.js 中文文档**（[vuejs-translations/docs-zh-cn](https://github.com/vuejs-translations/docs-zh-cn)）— CC BY 4.0
- **React 中文文档**（[reactjs/zh-hans.react.dev](https://github.com/reactjs/zh-hans.react.dev)）— CC BY 4.0

语料不入库，由 `npm run corpus` 现场下载，commit SHA 与署名写入 `data/meta.json`。代码 MIT，见 [LICENSE](LICENSE)。

## 局限

- 语料是技术文档，新闻 / 口语 / 古典中文未覆盖
- 查询由语料截取生成，不含错字、同义词、拼音输入
- 只测字面命中，不测语义
- 延迟为单进程单次测量；构建耗时与索引体积不可跨库比较

完整分析、根因与复现细节见 [REPORT.md](REPORT.md)。
