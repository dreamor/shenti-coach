# 大爆炸展开图生图调用契约（Mermaid · 能力自适应）

本文件规定 shenti-coach 把每道题的大爆炸展开图渲染成 PNG 的流程。渲染是纯程序行为，不需要多模态模型：**默认用本技能自带脚本**（不假设本机安装了 `data-visualization`），不可用时按第 1 节降级。禁止用 AIGC 文生图替代。

## 1. 渲染链路选择（按顺序探测，失败才降级）

1. **默认第一链路**：先写 JSON 规格（见第 2 节），再用本技能自带脚本一条命令生成 HTML + PNG，零第三方 npm 依赖：

   ```bash
   node <shenti-coach目录>/scripts/render_bigbang.mjs "<spec.json>" "<PNG绝对路径>" --width 1600 --scale 2
   ```

   脚本会自动生成同名 `.html` 便于复查。**只有输出 JSON 中 `ok:true` 且 `status:"ok"` 才算成功**。退出码：2 = 规格/公式/答案指纹校验失败（按报错改成 Unicode 纯文本或角度提示），3 = Mermaid 渲染失败或超时（必须修图，不能把带 Syntax error 的图当成功），4 = 未找到 Chrome（可设 `CHROME_PATH` 环境变量），5 = Node.js < 22（截图依赖 Node 内置 WebSocket）。脚本默认使用技能自带的 `scripts/vendor/mermaid.min.js`，离线可用；需要换源时设 `SHENTI_MERMAID_SRC=<url或file://路径>`。交付前可用 `--forbid "答案指纹"`（可重复）检查**标题、副标题、脚注、节点、连线**是否泄露答案；任一处命中都会以退出码 2 拒绝渲染。`build_bigbang.mjs` 直接调用时也支持同样的 `--forbid`。
3. 没有 Node/Chrome：`npx -y @mermaid-js/mermaid-cli -i in.mmd -o out.png`；仍失败则交付 Mermaid 源码 + 文本树，并说明图片生成失败的原因。
4. 若本机确实安装了 `data-visualization`，且其当前 SKILL.md 明确提供 validate/screenshot 接口，可作为备选：读取其 reference/mermaid-guide.md、reference/output-and-validation.md，用其 validate.js + screenshot.js。
5. 离线环境：默认已走本机 `scripts/vendor/mermaid.min.js`，无需联网；该文件缺失时才按第 3 条降级。

## 2. 数据准备（spec.json）

把该题文本树整理成 JSON 规格，与 HTML/PNG 放在同一目录：

```json
{
  "title": "第6题 · 审题大爆炸展开图",
  "mode": "explain",
  "subtitle": "题目核心式 ｜ 学科·章节（教材版本）｜ 连线：触发词·相关度",
  "nodes": [
    {"id": "ROOT", "text": "题目条件<br/>求什么", "cls": "root"},
    {"id": "Q1", "text": "Q1 显性关系", "cls": "cond"},
    {"id": "C1", "text": "C1 显性条件", "cls": "cond"},
    {"id": "H1", "text": "H1 隐含条件", "cls": "core"},
    {"id": "B1", "text": "B1 待填：原因", "cls": "core"}
  ],
  "groups": [
    {"id": "GQ1", "label": "Q1 显性关系", "nodes": ["Q1", "C1", "H1", "B1"]}
  ],
  "edges": [
    {"from": "ROOT", "to": "Q1", "label": "小问·核心"},
    {"from": "Q1", "to": "C1", "label": "触发词·核心"},
    {"from": "C1", "to": "H1", "label": "触发词·核心"},
    {"from": "Q1", "to": "B1", "label": "作答·核心"}
  ]
}
```

- **多小问必须按 Q 分组**：3 个小问以上，或节点超过 20 个时，用 `groups` 把每个 Q 的条件、隐含条件、B 卡放进同一子图；连线改成 `ROOT → Qn → C/H/B/G → …`。禁止所有非 ROOT 节点都直接连 ROOT 的星形图。
- `mode` 可选 `explain`（默认）或 `training`。训练模式第3步出图时必须写 `"mode": "training"`，脚注会自动改为“训练模式配图 · 只在第3步揭示条件与路径”，避免图与当前模式不一致；未写时按标题里的“训练”二字兜底识别。
- `groups` 的 `id` 用 `GQ1`、`GQ2`…，不能与节点 id 重名；同一节点只能出现在一个分组。分组标题写 `Q1 任务骨架`，不要写答案。
- 单问题目可以不用 `groups`；一旦用分组，所有组内节点都不再重复出现在组外。
- **分组归属只认显式来源**：只有来源标为 `Qn` 的条件/隐含条件才能进 `GQn`。总题干背景条件、题干图/选项图、知识点（K）一律挂 ROOT——它们属于整题，塞进某一问会误导学生。H 节点若引用了某条组内 C，就跟着那条 C 的组走；否则挂 ROOT 并保留 `C→H` 连线。
- **禁止按“词面相似度”猜归属**：背景句常因用词接近被误分到某一问。相似度只能用于提示，不能作为分组依据。

- `cls` 取值：`root` 题目 / `cond` 显性 / `core` 核心隐含 / `backup` 备用 / `disturb` 干扰 / `missing` 缺失待核实。
- 节点 id 只用字母数字下划线；显示文字写在 `text` 里，用 `<br/>` 换行，每行尽量不超过 15 字。
- **图内严禁 LaTeX**：不要写 `$x^2$`、`\frac{a}{b}`、`\ce{H2SO4}`。Mermaid 不解析 LaTeX，会原样显示甚至报语法错误。先转成 Unicode/纯文本：`x²`、`(a)/(b)`、`H₂SO₄`。渲染脚本会自动转换常见写法（含 `\sin/\cos/\ln/\mathbb/\rightleftharpoons` 等），也会处理题库里残留的 `\uXXXX`、字面量 `\n` 和 ASCII 双引号；但转换后仍有未知反斜杠命令或 `$` 会直接报错，必须人工修。
- 节点总数建议 8–20 个，单图上限 60；超过 24 个或一道题有 4 个以上小问时，**先在单图内按 Q 分组**；分组后仍超过 30 个，再拆成 2 张图（如 Q1–Q2、Q3–Q4），每张图都保留 ROOT 与同一套配色，不要硬塞成一张巨图。
- 星形图判定：非 ROOT 节点中有 70% 以上都直接连 ROOT，且存在 3 个以上 Q 节点时，视为不合格布局；必须改成 Q 分组层级。
- 节点与连线必须与八模块文本树一一对应，不增删知识点；**只写条件与路径，不写最终答案（区间、比值、数值、选项结论）**。
- 填空题：节点只能写 `B1 待填：数值/方向/名称/标号` 与判断依据，禁止出现待填词本身。实验题：待填仪器、操作、现象、结论同样不得上图；可写 `G1 由图读出……`。
- 题面缺公式、装置图或表格时，加一个红色缺失节点（`cls:"missing"`）`G0 题面缺失：……待核实`，并停止依赖该项的空白推导；不要用相似题条件补图。

输出目录：当前 workspace 下的 `data-vis/<学科>-<地区>-<年份>-第<题号>-<主题>/`（如 `<workspace>/data-vis/物理-辽宁-2026-第11题-玻璃砖折射率/`）。同一题的 JSON、HTML、PNG 放同一目录，文件名用中文描述（如 `第11题审题大爆炸展开图.html/.png`）。多套试卷同题号时，目录名必须带地区/年份/学科，禁止只用“第6题”导致互相覆盖。

## 3. Mermaid 图规范

- 图型固定 `flowchart LR`（左到右分层：题目→显性条件→隐含条件→知识点）。
- 节点 ID 纯字母数字（ROOT/C1/H1/E3/D…），显示文字放双引号内，用 `<br/>` 换行，每行≤15字。
- 连线标签格式：`|"触发词·相关度"|`，如 `C1 -->|"x²·核心"| H1`；干扰项用虚线 `-.->|"干扰"|`。
- 连线标签要写“题面触发词”，不要所有线都写“条件·核心”。同一触发词只出现一次；重复标签会让图失去教学价值。
- 固定配色（classDef）：
  - 题目 root：fill:#ede7f6, stroke:#5e35b1, color:#311b92
  - 显性条件 cond：fill:#e3f2fd, stroke:#1565c0, color:#0d47a1
  - 核心隐含 core：fill:#e8f5e9, stroke:#2e7d32, color:#1b5e20
  - 备用 backup：fill:#fff8e1, stroke:#f9a825, color:#6d4c41
  - 干扰 disturb：fill:#f5f5f5, stroke:#9e9e9e, color:#616161
  - 缺失 missing：fill:#ffebee, stroke:#c62828, color:#b71c1c
- 【二级结论】标注保留在节点文字内。

## 4. HTML 骨架（已验证可用）

标题、副标题、图例、脚注必须全部放在 `data-chart="true"` 容器内，否则截图缺失。页面白底便于截图。以下骨架仅用于理解结构；实际请用 `scripts/build_bigbang.mjs` / `scripts/render_bigbang.mjs` 生成，不要手写 HTML，脚本已处理 HTML 转义、公式转换和 Mermaid 错误检测。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>第N题 审题大爆炸展开图</title>
<script src="file:///绝对路径/shenti-coach/scripts/vendor/mermaid.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #ffffff; margin: 0; }
  .page-wrapper { max-width: 1600px; margin: 0 auto; padding: 32px 24px; }
  .card { background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; padding: 28px 24px; }
  h1 { font-size: 22px; color: #1f2937; margin: 0 0 6px; }
  .subtitle { font-size: 14px; color: #6b7280; margin: 0 0 16px; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: #374151; margin-bottom: 18px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 14px; height: 14px; border-radius: 3px; display: inline-block; border: 1.5px solid; }
  .sw-root { background: #ede7f6; border-color: #5e35b1; }
  .sw-cond { background: #e3f2fd; border-color: #1565c0; }
  .sw-core { background: #e8f5e9; border-color: #2e7d32; }
  .sw-backup { background: #fff8e1; border-color: #f9a825; }
  .sw-disturb { background: #f5f5f5; border-color: #9e9e9e; }
  .sw-missing { background: #ffebee; border-color: #c62828; }
  .mermaid { display: flex; justify-content: center; }
  .footnote { font-size: 12px; color: #9ca3af; margin-top: 14px; }
  @media (max-width: 768px) { .page-wrapper { padding: 16px 10px; } .card { padding: 16px 12px; } h1 { font-size: 18px; } }
</style>
</head>
<body>
<div class="page-wrapper">
  <div class="card" id="chart" data-chart="true">
    <h1>第N题 · 审题大爆炸展开图</h1>
    <p class="subtitle">题目核心式 ｜ 学科·章节（教材版本）｜ 连线上标注：触发词 · 相关度</p>
    <div class="legend">
      <span><i class="swatch sw-root"></i>题目</span>
      <span><i class="swatch sw-cond"></i>显性条件</span>
      <span><i class="swatch sw-core"></i>隐含条件 · 核心</span>
      <span><i class="swatch sw-backup"></i>备用</span>
      <span><i class="swatch sw-disturb"></i>干扰（本题用不上）</span>
      <span><i class="swatch sw-missing"></i>缺失 · 待核实</span>
    </div>
    <pre class="mermaid">
{{MERMAID_CODE}}
    </pre>
    <p class="footnote">审题教练 · 讲解模式配图 ｜ 铁律：只拆条件给路径，不给最终答案 ｜ 【二级结论】选填可直接用，解答题需先论证</p>
  </div>
</div>
<script>
  (async function () {
    const status = document.getElementById('render-status');
    try {
      if (!window.mermaid) throw new Error('mermaid-load-failed');
      mermaid.initialize({ startOnLoad: false, theme: 'default', flowchart: { htmlLabels: true, curve: 'basis' } });
      await mermaid.run({ nodes: document.querySelectorAll('.mermaid') });
      status.dataset.status = 'ok';
    } catch (e) {
      status.dataset.status = 'error';
      status.textContent = String(e && e.message ? e.message : e);
    }
  })();
</script>
</body>
</html>
```

## 5. 验证与截图

通用链路（本技能自带脚本）：

```bash
node <shenti-coach目录>/scripts/screenshot_html.mjs "<HTML绝对路径>" "<PNG绝对路径>" --width 1600 --scale 2
```

使用 data-visualization 时：

```bash
node <data-visualization目录>/scripts/validate.js "<HTML绝对路径>"
node <data-visualization目录>/scripts/screenshot.js "<HTML绝对路径>" "<输出前缀绝对路径>" 1600 1000
```

- 通过标准：SVG 正常渲染、无 JS 报错、无原始 Mermaid 源码残留；截图宽度默认 1600，节点特别多时可加宽。
- 脚本会检查 `.error-icon`、页面中的 `Syntax error`、以及 `#render-status[data-status="error"]`；任一命中即 `ok:false`，不要继续交付。
- 质检（多模态模型）：直接查看 PNG，检查文字有无重叠、截断、未渲染源码。
- 质检（非多模态模型）：`node <shenti-coach目录>/scripts/ocr.mjs "<PNG绝对路径>"`，把 OCR 文本与 HTML 中的节点文字逐条比对，确认关键节点都在；OCR 对公式符号可能失真，只用于查漏，不用于判错。
- 两种质检都不可用时，请用户确认成图，或降级交付文本树。
- 发现问题修复后重验，最多 2 次；仍失败则交付文本树并如实说明图片失败原因，不虚构图片、不用 AIGC 生图替代。

批量回归（题库/多题场景）：

```bash
# 1) 把多题生成图源 JSON：[{id, source}]
# 2) 逐个交给本地 Mermaid 解析，只查语法，不截图
node <shenti-coach目录>/scripts/check_mermaid_batch.mjs "<sources.json>" --json-out "<result.json>"
```

2026-11-26 用 exam-helper 全库 1045 道数学/物理/化学/生物真题做过一次批量语法回归：1045/1045 通过。该脚本只验证 Mermaid 语法，不替代文字重叠/截断的人工质检。

## 6. 交付

- 每题一行 `MEDIA:<PNG绝对路径>`（路径逐字符取自截图脚本实际输出），可另附一行 HTML 的 MEDIA。
- 正文不出现裸路径、不用 Markdown 图片语法替代 MEDIA。
- 多题试卷一题一图，随对应题目的八模块一起交付；训练模式仅第3步揭示后交付。

## 7. 参考样例

第6题（f(x)=x²−2ax+3 在[1,3]上具有单调性）的成图结构：ROOT 分出 C1解析式/C2具有单调性/C3闭区间/C5当a=2 四个显性条件；C1 经"x²·核心"到 H1开口向上、经"−2ax·核心"到 H2对称轴x=a；C2 经"具有·核心"到 H5全增或全减，再经"翻译·核心"到 H3轴不进区间内部【二级结论】，再经"边界·核心"到 H4轴压端点仍单调；C3 经"方括号·备用"到端点可取；C5 经"定轴·第2问核心"到 H6顶点最小远端最大；ROOT 虚线连干扰项（判别式·零点分布·奇偶性）。
