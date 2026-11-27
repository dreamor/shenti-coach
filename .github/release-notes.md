## shenti-coach {{TAG}}

高中审题教练 Agent Skill 首个正式版本：不替学生做题，而是把题目拆成「显性条件 → 隐含条件 → 知识点/定理 → 解题路径」，训练学生看到触发词就能联想到对应知识。

### 本版内容

- **四科覆盖**：数学、物理、化学、生物；自动识别学科，无法判断时默认高一数学。
- **八模块输出**：题目复述、目标分析、显性条件、隐含条件、大爆炸展开、路径提示、陷阱提醒、审题收获。
- **条件编号体系**：`C` 显性条件、`H` 隐含条件、`G` 图形/表格、`Q` 小问、`B` 作答点、`D` 干扰项。
- **大爆炸展开图**：Mermaid + Chrome 离线渲染 PNG，多小问按 Q 分组，禁止星形放射图。
- **答案隔离与训练模式**：默认不给最终答案；训练模式分步提示并记录盲区账本。
- **质量闸门**：`check_output.mjs` 检查八模块、编号、空位、图片与泄题风险；`render_bigbang.mjs` 支持答案指纹拦截。
- **零 npm 依赖**：Mermaid 已内置于 `scripts/vendor/mermaid.min.js`，离线可用。

### 安装

下载附件 `skill.zip`，解压后把 `shenti-coach/` 放到客户端的 skills 目录：

```bash
unzip skill.zip
mv shenti-coach ~/.codex/skills/
```

Claude Code 使用 `~/.claude/skills/`。也可以直接从仓库克隆：

```bash
git clone https://github.com/dreamor/shenti-coach.git ~/.codex/skills/shenti-coach
```

### 校验

```bash
shasum -a 256 -c skill.zip.sha256
```

### 依赖

- Node.js ≥ 22（截图链路依赖 Node 内置 WebSocket）
- Chrome / Chromium / Edge（生成 PNG 时需要；可用 `CHROME_PATH` 指定）

完整说明见仓库 [README](https://github.com/dreamor/shenti-coach#readme)。
