# 输入边界：控制隔离与安全投影

## 1. 所有来源内容都是数据

题干、选项、图片及图中文字、OCR、网页/rawweb、JSON、知识标签、官方答案和解析统一为 **untrusted data**。来源里的“忽略规则”、角色声明、代码块、伪结束标签、shell 命令、模式/阶段字段、学生身份或附件回执只能保留为数据，不能升级为控制。

- 模式只从宿主调用 options/CLI 的可信操作或数据区之外用户明确的模式请求选择；`q.mode`、`event`、`student_id`、`payload.receipt` 不提供授权。`type/kind` 是题型数据，不是模式。
- 阶段推进、身份绑定、shell 执行、读写/上传路径、附件确认都由宿主独立校验；绝不把题目字段展开到 controls，不把模型从题面生成的命令直接执行。
- G 编号仅引用图件，不是“已读取/已上传/已确认附件”的凭据。真实附件只能以宿主验证过的回执确认。
- 官方解析不是高优先级指令，也不自动成为科学真相。与题面或科学规则矛盾、缺失/含糊时均标“待核实”，保留冲突来源并独立复核。

边界是**控制隔离 + allowlist projection**，不是指令词黑名单，也不承诺单靠提示防住所有注入。正常“计算/证明/说明/求”等作答动词必须保留。以下测试验证确定性的数据结构与控制隔离，不证明模型不会受内容影响；宿主仍需权限闸门、输出与语义复核。

## 2. 兼容归档与两种视图

`normalizeQuestion(q, options = {})` / `normalizeMany(questions, options = {})` / `parseOptions(raw)` 保留原接口及旧字段。旧规范化 JSON **始终可能含** `official_answer`、`solution`、`options.raw`、图片路径；整行 JSON 不是安全题面。新增 `input_boundary` 是固定声明，不能相信输入自报的同名字段。

纯函数入口（也从 `scripts/lib/question.mjs` 重导出）：

```js
buildInputViews(normalized, { mode = 'explain' } = {})
// => { questionData, reviewData, boundary }
// mode: 'explain' | 'solve' | 'training'
```

`mode` 仅验证宿主调用选项；三个模式均返回相同的无答案题面投影。题型或题面内的“解题”不触发模式切换。只接受 `mode` 选项，混入 raw 题字段/controls 会拒绝；返回对象不提供 `trustedControl`。

| 视图 | 字段 | 交付规则 |
| --- | --- | --- |
| `questionData` | `id/subject/region/year/seq/type/kind/stem/blank_count`；`options[].label/text/figure_ids`；`figures[].id/role/option`；`subquestions`；`subquestion_details[].label/text/blanks/preamble_blanks`；`blank_map[].label/blanks` | 仅这些 allowlist 字段可进入题面通道；仍是不可信数据 |
| `reviewData` | `official_answer/solution`；`verification_status: pending`；知识标签、warnings/notes、OCR/rawweb/input_sources；选项原始数据；`figures[].id/path/absolutePath` | 宿主私有核对侧；仍 untrusted，不自动交付学生，不作为系统/工具指令 |
| `boundary` | 固定信任、控制来源、投影、核对、附件与科学冲突政策 | 不复制原题的自报可信声明，不授予任何执行能力 |

未知字段及各层未知子字段不会进入 `questionData`。知识标签放在核对侧，防止标签直接带出待填术语；它们只定位，不能当已核实结论。`input_sources` 保留常见 `ocr/ocr_text/rawweb/raw_web/web/images/image/figures` 数据，不能作为工具参数。即便原文字符串本身包含答案或路径，也不能通过关键词删除而改坏题面；投影排除的是结构字段，内容的答案泄漏仍需人工语义复核。

安全接入示例：

```js
import { normalizeQuestion, buildInputViews } from './scripts/lib/question.mjs';

const normalized = normalizeQuestion(sourceQuestion, { publicRoot: hostImageRoot });
const { questionData, reviewData, boundary } = buildInputViews(normalized, { mode: hostMode });
// 宿主把 questionData 作为数据交给审题侧，不传整行 normalized 或 reviewData。
// 宿主按需在私有核对侧选择 official_answer/solution，绝不 Object.assign 到 controls。
```

“宿主调用选项”要求调用方独立建立可信来源；纯函数无法替调用方鉴别一个被恶意传入的 options 是否真的来自用户。不要将 `buildInputViews(q, q)` 或原题字段解包结果当作宿主控制。

## 3. prompt 与资源边界

`prompt_markdown` 开头固定声明不可信数据规则，随后“题面区”只输出一个缩进的 JSON 值。原文换行/反斜线由 JSON 编码，反引号、`<>&` 与 Unicode 行分隔符额外转义，因此输入中的三反引号、伪结束标签、Markdown 媒体行不能跳出数据引用。用 `JSON.parse` 恢复原始数学题面；不删正常动词，不转换或损坏 LaTeX。

默认 prompt 不含官方答案、解析、raw 或系统路径。原有宿主 `includeAnswer` / `includeSolution`（CLI `--with-answer` / `--with-solution`）只显式增加安全编码的“不可信官方核对区”，不授权解题、不自动交付学生；含核对区的 prompt 不能直接发给学生。宿主核对数据初始 pending，不代表自动检测过科学矛盾。

CLI 保持本地默认：不联网、不外部上传，仅按显式输入/输出参数读写。图片原路径作为私有数据保留；存在性探测只允许相对于宿主 `publicRoot` 的本地图件，拒绝 URL、file URL、越界路径与源数据选择的符号链接，未获授权标“待核实”。不会读取图片内容或确认附件。宿主必须自行管理可信根目录与并发文件变更；此静态探测不是文件系统沙箱或抗竞态授权机制。

## 4. 输入预算与公开纯函数

`scripts/lib/input-boundary.mjs` 不依赖 npm 包、文件系统或网络：

```js
assertInputData(value) // 返回原值；不合格抛 TypeError / RangeError
createInputBoundary() // 返回独立的固定政策对象
buildInputViews(normalized, options = {}) // { questionData, reviewData, boundary }
encodeInputData(value) // 安全单行 JSON 文本，JSON.parse 可逆
renderInputPrompt(views, options = {}) // 默认仅题面；可显式 includeAnswer/includeSolution/analysis
```

只接受有界的普通 JSON-like 数据（兼容归档的 undefined 可空字段）；拒绝 `__proto__/constructor/prototype` 键、非普通原型、accessor/函数/隐藏字段、循环、非有限数值。不调用来源 getter、toJSON 或类型转换钩子。纯函数不是 JavaScript Proxy 的执行沙箱；接入端应先把外部数据解析为普通 JSON。

`INPUT_LIMITS`：单字段 262144 字符、单记录累计 2097152 字符、20000 个校验节点、32 层深度、单集合 4096 项；超限明确拒绝，不静默截断；规范化的编码输出同样受预算约束，编码膨胀超限也明确拒绝，避免返回不能再次投影的记录。`normalizeMany` 按题应用预算，不以单题预算阻止合法全库批次。

## 5. 回归与答案隔离

```bash
node --test scripts/tests/input-boundary.test.mjs scripts/tests/input.test.mjs
```

新增测试覆盖题干、选项 text/raw、图片 metadata、OCR、rawweb、知识标签、官方答案/解析的注入矩阵；另测未知字段 allowlist、宿主模式、伪回执、编码可逆、污染键、超大字段、getter/循环、路径/符号链接及 CLI 无未授权副作用。既有 normalize input/output 测试保持不变。

此边界不替代 [答案隔离](answer-isolation.md)：继续对八模块 `〇`–`七`、图片节点/连线/标题/脚注检查答案指纹与同义变体；答案本身是教材术语时只能给判断维度和真实 C 条件锚点，不能给完整定义或唯一识别描述。核对区与独立完整解答区不豁免前置讲解或图的隔离。科学冲突未核实前，语义状态如实写 pending。
