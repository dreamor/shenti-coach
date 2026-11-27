## shenti-coach {{TAG}}

高中审题教练 Agent Skill：不替学生做题，而是把题目拆成「显性条件 → 隐含条件 → 知识点/定理 → 解题路径」，训练学生看到触发词就能联想到对应知识。

### 四项增强

- **默认短页 + 完整 audit**：学生默认读 30 秒速览、核心 C/H 链、收敛路径、陷阱与迁移；八模块、教材映射、B 卡与文本树完整留在独立 `audit.md`。独立留存不等于自动向学生发送教师附件。
- **能力自适应、多媒介交付**：依据可信客户端能力选择 MEDIA、Markdown 本地图片引用或文件路径；校验真实 PNG 与渲染结果。`reference-ready` / 本地路径不冒充已附上、已上传或远程可访问；图片不可用如实降级。
- **自适应训练与独立迁移**：先独立尝试，再按需逐条提示；按真实状态限制暂停、恢复、停止、揭示与当前轮次回复。区分独立完成和提示后完成，独立换题迁移通过才作为掌握证据。
- **所有输入数据边界 + 匿名多学生账本**：题面、OCR、题库 payload、答案解析、学生回复、训练状态、账本、交付 manifest 均是数据，不能授权切模式、跳阶段、执行命令、读写路径或附件送达。匿名学生/题次 ID 隔离账本，只保存条件类型与学习证据；不收身份、原题或原回复，持久化与覆盖/删除需要可信调用方明确授权。

### 兼容能力与门禁

- 保留 **v2.2 跨平台 OCR**：多模态直接看图；非多模态降级时使用 macOS Vision → tesseract → 明确报错。引擎、语言包缺失或读不到文字均非零退出，不伪造识别成功。
- 保留四科、条件编号、考纲/教材映射、八模块完整审计、答案隔离、训练阶段与 Mermaid + Chrome 离线生图；完整解答只在可信用户明确请求后独立输出。
- 新学生短页不能冒充完整八模块审计；自动结构 PASS 不等于教学语义正确，不豁免语义复核、答案指纹或迁移验证。
- `npm test` 为独立 `node --test`，解压包无需 `.github` / `.git` 即可运行；仓库 CI 仍严格执行 `npm run lint && npm test`。缺 zip / Chrome 的本地工具相关测试明确跳过，CI 实际运行归档、重打包防残留与生图，不预先承诺测试计数。

### 发布与包自检

- 发布只创建新 Release，已有同 tag 记录即停止；通过分页 API 查询记录，鉴权/网络错误不能冒充不存在。不改写旧标签、Release 或附件。
- 标签来源必须匹配 `ci.yml` 精确 SHA 的成功 **push/main** 运行，不能用 PR、tag 或 reusable CI 替代。
- 发布 job 独立构建自己的 ZIP，再校验 SHA-256、解压 layout、`VERSION/package.json/SKILL.md` 三处版本与包内 `npm test`。
- Git 源码只收已跟踪的固定发布源码；无 Git 的源码包只允许严格固定文件名/后缀，新增格式需审查。保留 assets、scripts/tests/vendor、examples 与 OCR，不包含 `.git/.github/dist`、未跟踪学生数据或运行账本；全新归档不保留旧 ZIP 残留。
- `github.token` 发布不会自动级联触发徽章；维护者可显式 dispatch `badges.yml`，不需要新增 PAT secret，徽章提交普通 push 且失败可见。

### 安装与校验

下载附件 `skill.zip` 和 `skill.zip.sha256`，先校验，再解压到客户端 skills 目录：

```bash
TAG="{{TAG}}"
shasum -a 256 -c skill.zip.sha256
unzip skill.zip
node shenti-coach/scripts/verify_package.mjs shenti-coach --version "${TAG#v}"
(cd shenti-coach && npm test)
mv shenti-coach ~/.codex/skills/
```

其中 `TAG` 为本次发布标签（{{TAG}}）。Claude Code 使用 `~/.claude/skills/`。也可从仓库克隆：

```bash
git clone https://github.com/dreamor/shenti-coach.git ~/.codex/skills/shenti-coach
```

### 依赖

- Node.js ≥ 22；无第三方 npm 依赖，Mermaid 已内置。
- Chrome / Chromium / Edge（生成 PNG 时需要，可用 `CHROME_PATH` 指定）。
- 可选 OCR：macOS 需 Xcode Command Line Tools；其他平台需 `tesseract`，中文另装 `chi_sim` 语言包。

完整说明见仓库 [README](https://github.com/dreamor/shenti-coach#readme)。
