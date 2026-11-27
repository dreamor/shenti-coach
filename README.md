# 高中审题教练 · shenti-coach

一个面向高中数学、物理、化学、生物的 **Agent Skill**：不急着替学生做题，而是把题目拆成「显性条件 → 隐含条件 → 知识点/定理 → 解题路径」，训练学生“看到某个词，能想到对应知识”的审题能力。

遵循 [Agent Skills 规范](https://agentskills.io/specification)，可直接用于 Codex、Claude Code 及其他兼容 Agent Skills 的客户端。

[![CI](https://github.com/dreamor/shenti-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/dreamor/shenti-coach/actions/workflows/ci.yml)
[![Release](assets/badges/release.svg)](https://github.com/dreamor/shenti-coach/releases/latest)
[![License: MIT](assets/badges/license.svg)](LICENSE)

![审题大爆炸展开图示例](examples/demo-bigbang.png)

## 它解决什么问题

- 学生“看得懂答案，但自己想不到”——把条件与知识点的触发关系讲清楚。
- 题目条件多、隐含条件漏——用编号体系逐条排查，四科各有专属隐含条件库。
- 讲题容易直接报答案——内置“不泄题”铁律与答案指纹闸门。
- 题目需要一张结构图——内置 Mermaid + Chrome 的离线生图链路，零 npm 依赖。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 八模块输出 | 题目复述、目标分析、显性条件、隐含条件、大爆炸展开、路径提示、陷阱提醒、审题收获 |
| 四科覆盖 | 数学、物理、化学、生物；自动识别学科，无法判断时默认高一数学 |
| 条件编号 | `C` 显性条件、`H` 隐含条件、`G` 图形/表格、`Q` 小问、`B` 作答点、`D` 干扰项 |
| 考纲 + 教材映射 | 每个条件写清“课标要求 + 教材章节 + 知识点内容” |
| 大爆炸图 | 自动生成 PNG；多小问按 Q 分组，禁止星形放射图 |
| 答案隔离 | 讲解模式不输出最终答案；填空题一空一 B，开放题三问自检 |
| 三种模式 | 讲解模式（默认）、训练模式（分步提示）、解题模式（用户明确要求时才完整解答） |
| 结构闸门 | `check_output.mjs` 检查八模块、编号、空位、图片与泄题风险 |

## 下载 Release 安装

从 [Releases](https://github.com/dreamor/shenti-coach/releases/latest) 下载 `skill.zip` 与 `skill.zip.sha256`，解压后得到 `shenti-coach/` 目录：

```bash
unzip skill.zip
mv shenti-coach ~/.codex/skills/
```

校验附件：

```bash
shasum -a 256 -c skill.zip.sha256
```

`skill.zip` 内含 `SKILL.md`、`references/`、`scripts/`、`examples/`、`README.md`、`LICENSE` 与 `VERSION`，解压即可使用。

## 从源码安装

### Codex

```bash
git clone https://github.com/dreamor/shenti-coach.git ~/.codex/skills/shenti-coach
```

如果目录已存在，更新即可：

```bash
git -C ~/.codex/skills/shenti-coach pull
```

开发时也可以直接软链接本仓库：

```bash
ln -s "$PWD" ~/.codex/skills/shenti-coach
```

### Claude Code

```bash
git clone https://github.com/dreamor/shenti-coach.git ~/.claude/skills/shenti-coach
```

### 其他客户端

把整个仓库放到客户端的 skills 目录即可。入口是根目录的 `SKILL.md`，`references/` 与 `scripts/` 必须一起保留。

## 依赖

- **Node.js ≥ 22**：运行校验与生图脚本；截图链路依赖 Node 内置的 WebSocket。
- **Chrome / Chromium / Edge**：把 HTML 截图成 PNG；可用 `CHROME_PATH` 指定浏览器路径。
- **无第三方 npm 依赖**：Mermaid 已内置于 `scripts/vendor/mermaid.min.js`，离线可用。
- macOS 可选：`swift scripts/ocr.swift <PNG>` 用于图片文字查漏。

## 怎么用

在支持技能的环境中直接贴题目，例如：

> 用审题教练拆一下这道题：已知函数 f(x)=lg(x²−2x−3)，求其定义域。

常用说法：

- **默认**：讲解模式，只拆条件与路径，不给最终答案。
- **“训练模式”**：分步提示，学生先想，再逐步揭示条件与路径。
- **“解题”**：明确要求后才进入完整解答。
- **“批改 / 审题训练”**：按训练模式记录盲区账本。

## 目录结构

```text
.
├── SKILL.md                     # 技能入口：铁律、工作流、八模块模板
├── references/                  # 按需加载的规则库
│   ├── reading-checklist.md     # 五步读题法 + 自检清单
│   ├── question-type-playbooks.md
│   ├── subject-libs.md          # 四科隐含条件库
│   ├── liaoning-textbook-map.md # 教材章节与考纲映射口径
│   ├── bigbang-image.md         # 生图规格与质检
│   ├── answer-isolation.md      # 答案隔离与 B 卡矩阵
│   ├── modes-and-input.md       # 讲解/训练/解题模式、图片输入
│   ├── batch-run.md             # 题库批量跑题
│   ├── blindspot-ledger.md      # 训练模式盲区账本
│   ├── experiment-checklist.md  # 实验题检查表
│   ├── example.md               # 完整示例
│   ├── regression-suite.md      # 回归题库说明
│   └── changelog.md
├── scripts/
│   ├── check_output.mjs         # 结构 / 泄题 / 训练模式闸门
│   ├── render_bigbang.mjs       # spec.json → HTML → PNG
│   ├── build_bigbang.mjs
│   ├── screenshot_html.mjs
│   ├── normalize_question.mjs   # 题库输入规范化
│   ├── preflight_question.mjs   # 写八模块前预检
│   ├── check_mermaid_batch.mjs
│   ├── ocr.swift
│   └── vendor/mermaid.min.js
└── examples/
    ├── demo-spec.json
    └── demo-bigbang.png
```

## 质量闸门

### 结构闸门

```bash
node scripts/check_output.mjs output.md \
  --type fill \
  --blanks 1 \
  --answer-slots 1 \
  --q-count 1 \
  --require-blank-map \
  --require-media \
  --answer "答案指纹"
```

严格模式会额外拦截答案泄露，必须同时提供至少一个非空 `--answer` 指纹。计数参数必须是非负安全整数；缺值或非法参数以退出码 2 拒绝，不会显示 PASS。数字指纹不会命中 `C1`、`H1` 等编号或其他数值内部；仍需人工检查同义改写与语义泄题。

解题模式使用 `--solution` 时，只有独立“完整解答”标题之后允许答案，前置八模块与配图仍须隔离答案；训练模式不接受完整解答区豁免。

```bash
node scripts/check_output.mjs output.md --strict-answer --answer "答案指纹" ...
```

训练模式：

```bash
node scripts/check_output.mjs training.md --mode training --answer "答案指纹"
```

### 生图闸门

```bash
node scripts/render_bigbang.mjs spec.json bigbang.png \
  --width 1600 --scale 2 --forbid "答案指纹"
```

退出码约定：

| 退出码 | 含义 |
| ---: | --- |
| 0 | 渲染成功，输出 JSON 中 `ok:true` 且 `status:"ok"` |
| 2 | 规格 / 公式 / 答案指纹校验失败 |
| 3 | Mermaid 渲染失败或超时 |
| 4 | 未找到 Chrome，可用 `CHROME_PATH` 指定 |
| 5 | Node.js < 22，缺少内置 WebSocket |

重新生成示例图：

```bash
npm run demo:render
```

## 开发、CI 与发布

本地自检与打包：

```bash
npm run lint      # 元数据、JSON、JS 语法、绝对路径、示例规格、结构闸门
npm test          # lint + Node 原生行为回归（答案隔离、输入保真、预检与模式边界）
npm run package   # 生成 dist/skill.zip 与 dist/skill.zip.sha256；需 zip / unzip
npm run verify    # test + package
```

GitHub Actions：

- **CI**（`.github/workflows/ci.yml`）：在 push / PR 时运行 `npm test`，实际渲染示例 PNG，并打包、校验 SHA-256、从解压包运行行为回归；示例渲染的中间产物仅写入 `dist/`。
- **Release**（`.github/workflows/release.yml`）：推送 `v*` 标签后先复用 CI，再校验标签与 `package.json` 版本一致，构建 `skill.zip`，创建 GitHub Release 并上传附件。

发布新版本：

```bash
# 先同步 package.json 与 SKILL.md 的版本号
git tag v2.1.0
git push origin v2.1.0
```

## 设计原则

1. **默认不解题**：只给路径提示，答案隔离。
2. **每个条件标触发词**：教“怎么想到”，不是只教“是什么”。
3. **隐含条件必须有来源**：由哪条显性条件的哪个词触发。
4. **发散后必须收敛**：核心 / 备用 / 干扰分级，最后收敛成 1–2 条路径。
5. **知识点必须准确**：不确定写“待核实”，禁止编造定理、课标条文、页码。
6. **结构 PASS ≠ 语义 PASS**：闸门只证明结构与答案隔离，条件解释仍需人工复核。

## 适用范围与声明

- 教材章节映射默认按辽宁地区高中教材口径整理；其他地区使用前请核对本地教材。
- 本技能用于审题训练与教学辅助，不替代教师讲解，也不保证覆盖所有题型变体。
- 题目中的公式、装置图或表格缺失时，技能会标 `G0 题面缺失：……待核实`，不会自行补条件。

## License

[MIT](LICENSE)
