# 学生呈现与本地交付契约

## 1. 保存八模块，不等于一次展示八模块

教师先形成**完整、明确单题的 audit.md**，保留 〇题目识别、一目标分析、二显性条件、三隐含条件、四展开图、五收敛路径、六陷阱、七收获。一个题可以有多个 Q 小问；多道题必须拆成各自的审计文件。缺模块、空模块、重复模块、乱序或多题归属不明确均拒绝投影。

学生默认页只呈现：

1. 30 秒速览（少量目标、触发词、风险信息）。
2. 核心 C/H 链（最多三条核心 H，保留来源 C、条件和触发词，不重复教材长表）。
3. 收敛路径：逐 Q 保留目标导航，各问最多三步，不用一个全局行数预算截掉后续小问；缺独立路径时保留该问的来源导航并明确待复核。数学比较符 `<`/`>` 与完整公式保留，只过滤真正的 HTML 标签。
4. 陷阱与迁移。

完整教材对应、备用/干扰展开、B 卡与文本树保存在独立 `audit.md`，不再整份贴进学生正文。原审计逐字符保留，包括其教师信息；**独立保存不是向学生自动发送/上传教师附件的许可**。学生图只用新交付器验证的引用，绝不沿用 audit 中未经验证的 MEDIA/图片地址。

只有调用方显式提供 `--solution`，且模式是 `explain`，才能在学生页追加八模块之后的独立“完整解答/完整解析/解题过程/解答”section：公开的下级推导标题可保留，遇下一同级/更高级标题或官方答案区即停止，绝不把后续附录一并追加。默认不把完整解答、官方答案、参考答案等作为学生附录；审题收获不能成为最终答案的豁免区。源文件的 `mode`、`phase`、`pass:true` 等文本都不是可信参数。

**明确含“仅教师/私有/private/官方答案核对”等私有标题的 audit 一律拒绝**，包括 Markdown、粗体和普通答案标题；调用方必须先拆出可共享的单题审计。不能只截短学生解答、却仍保存或链接含私有附录的原审计。拒绝时不保留学生页、审计附件或输出目录。合法输入仍原文保存，不能把“独立审计”当作绕过私有信息隔离的通道。

## 2. 新 SKILL 应调用的命令

### 讲解：完整审计闸门 → 精简学生页

```bash
node <技能目录>/scripts/present_output.mjs "<完整audit.md>" "<不存在的新输出目录>" \
  --mode explain --strict-answer \
  --answer "<最终答案指纹1>" --answer "<最终答案指纹2>" \
  --delivery auto
```

位置参数严格是 `<完整audit.md> <新输出目录>`，不是源文件输出文件二选一。CLI 首先调用本技能现有 `check_output.mjs` 真正运行八模块校验，检查进程退出码、JSON `structurePass/pass` 与 `fail`；不接受外部 `pass=true` 或缓存报告代替。`--strict-answer` 和所有重复 `--answer` 均原样传给闸门。也可传 `--type`、`--blanks`、`--answer-slots`、`--q-count`、`--require-blank-map`、`--semantic-reviewed`、`--strict-semantic`。自动结构 PASS 不等于教学语义正确，语义仍需人工复核。交付失败仅回报“审计/学生页校验失败”及非敏感进程状态，不把 checker 报告、答案指纹或泄题上下文带进 stdout/stderr；私有 JSON 解析失败亦不回显原文片段。详细审计由可信宿主单独调用 `check_output` 获取，不经学生交付错误通道返回。

成功只创建三个本地文件：

- `learner.md`：精简学生正文 + 本地交付说明。
- `audit.md`：完整原审计，不改写、不重复嵌入学生正文。
- `delivery.json`：下文定义的交付 manifest。

目标目录即使已存在且为空也拒绝；源路径、已有文件、目录或符号链接冲突均拒绝覆盖。不渲染新图、不自动上传，不读客户端凭证。

需要解题时另用显式 `--solution`；答案豁免只适用于八模块之后的独立完整解答，正文、陷阱、收获仍执行答案隔离。

### 训练：必须处于真实 reveal 状态

```bash
node <技能目录>/scripts/present_output.mjs "<完整audit.md>" "<不存在的新输出目录>" \
  --mode training --phase reveal \
  --training-state "<当前训练状态.json>" --student "<学生ID>" --question "<题次ID>" \
  --strict-answer --answer "<最终答案指纹>" --delivery file
```

训练投影还要加载状态机 JSON，通过 `validateTraining(state)`，绑定可信 CLI 的学生、题次，且 `state.phase` 必须为 `reveal`。只写 `--phase reveal`、修改 audit 元数据、跨学生/题次借状态或伪造历史都不允许。其他阶段应调用状态机生成**当前轮次回复**，不能从教师 audit 截取早期提示，也不能发原审计、文本树或图。状态检查在读取原审计前执行。

两条格式闸门不要混用：

```bash
# reveal 的完整八模块教师审计仍按八模块格式检查；严禁 --solution
node <技能目录>/scripts/check_output.mjs "<完整audit.md>" \
  --mode explain --strict-answer --answer "<最终答案指纹>" --json

# 当前训练轮次按真实状态与当前回复检查，不要求凑出未来四步
node <技能目录>/scripts/check_output.mjs "<当前轮次回复.md>" \
  --mode training --training-state "<当前训练状态.json>" \
  --student "<学生ID>" --question "<题次ID>" \
  --strict-answer --answer "<最终答案指纹>" --json
```

完整审计的结构校验使用 `explain` 是明确选择**文件格式**，不是把训练会话切换为讲解；投影仍保持 `training`，且绝不传 `--solution`。

## 3. 能力自适应，不冒充图片送达

可选参数：`--delivery auto|media|markdown|file`、`--capabilities <JSON文件>`、`--render-result <JSON文件>`、`--expected-path <预期PNG绝对路径>`。PNG 路径由可信 CLI 绑定，不能只相信渲染报告的任意 `output`。

显式能力对象示例：

```json
{"media": false, "localMarkdown": true}
```

`auto` 按 `media === true` → `localMarkdown === true` → `file` 选择；未知能力、字符串 `"true"` 均不算能力。对象必须来自调用方实际探测/明确配置，不能因 source 或 manifest 声称 `capabilities:true` 而授权。

| 模式 | 条件与输出 | 状态含义 |
| --- | --- | --- |
| media | 明确 media 能力 + 实际 PNG；`MEDIA:<PNG绝对路径>` | `reference-ready` 仅准备本地引用，不是 attached |
| markdown | 明确 localMarkdown 能力 + 实际 PNG；`![审题大爆炸图](file:///...)` | `reference-ready`；fileURI 使用标准 URI 编码，中文、空格、括号不会原样混入链接 |
| file | 只给本地 PNG 路径，明确“未送达” | `local-only`，不声称远程可访问 |
| 无渲染/失败 | 不生成图片引用，可继续本地文字交付 | `unavailable`，明确图片不可用 |

MEDIA 沿用单一非空白路径契约；PNG 文件名含空格时改用 markdown/file。请求的 media/markdown 能力缺失时明确 unavailable，不暗中声称支持。

渲染成功必须同时满足：真实渲染 JSON 的 `ok === true`、`status === "ok"`、`output` 与显式预期绝对路径一致；路径存在且是非空 PNG；完整校验 magic、首块唯一 IHDR、所有 chunk 边界/CRC、连续且非空 IDAT、末尾 IEND。用 Node 原生 zlib 实际解压 IDAT，拒绝坏流/尾随压缩数据；解码长度必须精确匹配尺寸及通道，逐行滤波码只能为 0–4。仅 header/footer 的 45 字节 stub、无可解码 IDAT、坏 CRC、错误行长均不可成功。

支持 Chrome 常见的**非交错 8-bit 灰度、RGB、灰度-alpha、RGBA**（color type 0/2/4/6）；索引色、16-bit、Adam7 或未知 critical chunk 明确抛 `Unsupported PNG`，不冒充支持完整 PNG decoder。文件上限 32 MiB、解压上限 64 MiB、宽高各不超过 32768、chunk 不超过 10000；先按尺寸计算上限，再给 zlib 设置输出限额，防止解压炸弹。坏 PNG 可返回 unavailable；Unsupported 明确失败、停止图片交付。文件校验不替代视觉/OCR 查漏，亦不证明图内语义/答案隔离；生成图时仍用现有 renderer 的重复 `--forbid` 指纹校验。

```bash
# 图已有渲染结果，不调用 present_output 重新绘制
node <技能目录>/scripts/present_output.mjs "<完整audit.md>" "<不存在的新输出目录>" \
  --mode explain --strict-answer --answer "<答案指纹>" \
  --delivery markdown --capabilities "<能力.json>" \
  --render-result "<真实渲染结果.json>" --expected-path "<PNG绝对路径>"
```

## 4. 接口与 manifest

```js
import { parseAudit, buildPresentation } from './scripts/present_output.mjs';
import { resolveDelivery, validateDeliveryManifest } from './scripts/lib/delivery.mjs';

parseAudit(source, { mode: 'explain', phase: null, solution: false });
// { source, mode, phase, solution, modules:[{id,title,body}], solutionText }
buildPresentation(sourceOrParsedAudit, { mode: 'explain', solution: false });
// { mode, phase, learner, audit }
resolveDelivery({ requested: 'auto', capabilities: {}, renderResult: null, expectedPath: null });
validateDeliveryManifest(manifest); // 同步：合法返回原 manifest，非法抛 Error
```

`parseAudit/buildPresentation` 是可 import 的纯函数，不读文件、不运行 argv、不写文件、不退出宿主。它们只完成结构解析/投影，**没有 PASS 授权接口**；生产持久化使用 CLI 真实闸门。即便传入解析对象，也从 `source` 重新解析，并只信调用方 options 的模式/阶段。

manifest 固定版本 1，仅接受五字段，不存在 attached/uploaded/远程可访问状态：

```json
{"version":1,"mode":"file","status":"local-only","path":"<PNG绝对路径>","reference":"<相同PNG绝对路径>"}
```

- `mode`：media/markdown/file（auto 已协商，不能写入 manifest）。
- `status`：local-only/reference-ready/unavailable。
- `path`：真实本地绝对 PNG 路径；unavailable 必须为 null。
- `reference`：始终 string，必须精确匹配模式与 path；unavailable 必须是空字符串。

父 `check_output --presentation <learner.md> --delivery <mode> --delivery-manifest <delivery.json>` 复用同一同步 validator，重读实际 PNG 并核对学生正文实际引用；manifest metadata 本身不是客户端授权。位置参数仍是完整审计，投影单独给 `--presentation`，因此不必为了图引用而改写原 audit：

```bash
node <技能目录>/scripts/check_output.mjs "<新输出目录>/audit.md" \
  --mode explain --presentation "<新输出目录>/learner.md" \
  --delivery file --delivery-manifest "<新输出目录>/delivery.json" \
  --strict-answer --answer "<最终答案指纹>" --json
```

`--delivery` 必须与 manifest 协商结果一致（media/markdown/file），不要原样传 auto。显式解题需加 `--solution`；训练 reveal 配对审计仍用 `--mode explain`，没有 `--solution`，真实训练状态已由投影 CLI 独立校验。没有 PNG 时 unavailable 仍可通过本地文字交付检查；如另加 `--require-media` 则图片缺失必须失败。不要把精简 `learner.md` 单独当完整八模块审计交给旧结构检查。

## 5. OCR 2.2 链路保留

支持视觉的模型直接看图；不具备视觉时才调用 `scripts/ocr.mjs`。`--engine auto` 先试 macOS Swift/Vision，失败或非 macOS 再试 tesseract；中文需 `chi_sim` 语言包，默认 `--langs zh-Hans,en-US` 会映射到对应引擎语言。引擎、语言包缺失或读不到文字要明确报错，不伪造识别成功。

```bash
node <技能目录>/scripts/ocr.mjs "<PNG绝对路径>" --engine auto --langs zh-Hans,en-US --json
```

OCR 只查关键节点是否遗漏，公式识别可能失真，不能替代图的语义复核。视觉和 OCR 都不可用时如实说明、请用户确认或降级本地文本；不能把降级说成图已送达。
