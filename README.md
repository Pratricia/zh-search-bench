# zh-search-bench

[![ci](https://github.com/Pratricia/zh-search-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/Pratricia/zh-search-bench/actions/workflows/ci.yml)

测几个 JS 全文搜索库在中文上的召回率：FlexSearch、MiniSearch、Lunr、Fuse.js、Orama。每个库测默认配置和修复配置，一共 15 种。默认配置就是装完直接用，修复配置按各库文档和源码改，官方配置用库自己提供的中文方案。

这个仓库只做测量，没有实现搜索库或分词器。具体改法在 `src/adapters.mjs`，每个适配器上面有注释。

语料是 Vue 和 React 的中文文档，1740 篇，81.5 万字。查询 727 条，从文档里截连续片段，标准答案就是「原文里有没有这个子串」。所以测的是字面命中，不涉及语义。

## 结果

k=10，727 条查询平均：

| 配置 | hit@10 | P@10 | 两字以上 |
|---|---:|---:|---:|
| Fuse.js（阈值 0，基准） | 100% | 52.2% | 100% |
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

Lunr 和 Orama 默认基本搜不到中文（0.1% 和 0%），也不报错。Lunr 光装官方中文插件还不够，查询端是按空格切的，得自己再切一遍，这样能到 90.6%；Orama 换二元组分词是 97.1%。

单字查询是二元组的短板：100 条里有 99 条在二元组索引里根本没有对应 token，怎么排都搜不到。去掉单字后，FlexSearch 和 MiniSearch 的二元组方案都在 99.5% 以上。

Fuse.js 那行是把 threshold 设成 0 当基准用，等价于逐字比对，所以是 100%。它用来确认评测没写错，不是推荐用法。

## 怎么跑

```bash
npm install
npm run corpus    # 按 commit 下载语料
npm run queries   # 生成查询和标准答案
npm run check     # 检查标注是否自洽、查询是否过期
npm run verify    # 最小复现：一个库、一篇文档、一句原文查询
npm run bench     # 跑全部配置
```

只想冒烟测试：

```bash
BENCH_LIMIT=60 npm run bench
```

结果写进 `results/results.json`，每个配置、每个查询集都有，还记了语料指纹和依赖版本。

## 目录

```
scripts/build-corpus.mjs     下载 + 清洗 + 按小节切分语料（锁定 commit）
scripts/build-queries.mjs    生成查询和标准答案
scripts/check-data.mjs       检查标注自洽、查询未过期
scripts/check-docs.mjs       核对文档数字和结果是否一致
scripts/verify-minimal.mjs   最小复现（单文档、单查询、多语言）
scripts/run.mjs              跑基准，输出 results/results.json
src/tokenize.mjs             中文二元组切分
src/adapters.mjs             15 种配置的适配器（默认 / 修复 / 官方）
REPORT.md                    根因、方法和逐项数据
```

## 数据来源

- Vue.js 中文文档（[vuejs-translations/docs-zh-cn](https://github.com/vuejs-translations/docs-zh-cn)），CC BY 4.0
- React 中文文档（[reactjs/zh-hans.react.dev](https://github.com/reactjs/zh-hans.react.dev)），CC BY 4.0

语料不入库，`npm run corpus` 现场下载，commit SHA 和署名写在 `data/meta.json`。代码用 MIT，见 [LICENSE](LICENSE)。

## 限制

- 只有技术文档，新闻、口语、古文没测
- 查询是从语料里截的，没有错字、同义词、拼音
- 只测字面命中
- 延迟只跑了一遍；构建耗时和索引体积也不能跨库比

根因和完整数据在 [REPORT.md](REPORT.md)。
