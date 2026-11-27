#!/usr/bin/env node
// 由 JSON 规格生成标准大爆炸展开图 HTML（不负责截图）
// 规格字段: { title, subtitle, mode?, footnote?, nodes:[{id,text,cls}], edges:[{from,to,label,dashed?}] }
// cls: root | cond | core | backup | disturb | missing
// 用法: node build_bigbang.mjs <spec.json> <out.html> [--mermaid-src <url>]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertRenderableText,
  escapeHtml,
  normalizeMathText,
  toMermaidLabel,
} from './lib/text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASSES = ['root', 'cond', 'core', 'backup', 'disturb', 'missing'];
const CLASS_DEFS = [
  '  classDef root fill:#ede7f6,stroke:#5e35b1,color:#311b92',
  '  classDef cond fill:#e3f2fd,stroke:#1565c0,color:#0d47a1',
  '  classDef core fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20',
  '  classDef backup fill:#fff8e1,stroke:#f9a825,color:#6d4c41',
  '  classDef disturb fill:#f5f5f5,stroke:#9e9e9e,color:#616161',
  '  classDef missing fill:#ffebee,stroke:#c62828,color:#b71c1c',
].join('\n');

const LEAK_PATTERNS = [
  [/故选|选择\s*[A-H]|答案[是为：:]|正确答案|正确选项|综上(所述)?[，,]?得?/i, '疑似结论/答案'],
  [/∴\s*[^，。；]{0,20}[=＝<>≤≥]/i, '疑似推出结论'],
];

function defaultMermaidSrc() {
  if (process.env.SHENTI_MERMAID_SRC) return process.env.SHENTI_MERMAID_SRC;
  const vendor = path.join(HERE, 'vendor', 'mermaid.min.js');
  return pathToFileURL(vendor).href;
}

export function validateSpec(spec, options = {}) {
  const warnings = [];
  const errors = [];
  const forbidTerms = (options.forbidTerms ?? []).filter(Boolean);
  const checkAnswerIsolation = (value, where) => {
    const raw = String(value ?? '');
    const rendered = normalizeMathText(raw);
    for (const [re, label] of LEAK_PATTERNS) {
      if (re.test(rendered)) warnings.push(`${where} ${label}，审题配图不应出现最终结论`);
    }
    for (const term of forbidTerms) {
      if (raw.includes(term) || rendered.includes(normalizeMathText(term))) errors.push(`${where} 命中答案指纹“${term}”；请改写为条件/角度/判据`);
    }
  };
  if (!spec || typeof spec !== 'object') {
    throw new Error('规格必须是 JSON 对象');
  }
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const groups = spec.groups ?? [];
  if (!Array.isArray(nodes) || !nodes.length) errors.push('spec.nodes 为空');
  if (!Array.isArray(edges)) errors.push('spec.edges 必须是数组');
  if (spec.groups !== undefined && !Array.isArray(spec.groups)) errors.push('spec.groups 必须是数组');
  if (spec.mode !== undefined && !['explain', 'training'].includes(spec.mode)) {
    errors.push(`spec.mode 只能是 explain 或 training（当前：${spec.mode}）`);
  }
  if (nodes.length > 60) errors.push(`节点 ${nodes.length} 个，超过 60；请把知识点合并或拆成两张图`);

  // 标题/副标题/脚注同样面向学生，不能成为答案指纹的漏网区。
  for (const field of ['title', 'subtitle', 'footnote']) {
    const value = String(spec[field] ?? '');
    if (!value) continue;
    checkAnswerIsolation(value, field);
  }

  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n !== 'object') { errors.push('节点必须是对象'); continue; }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(n.id ?? ''))) errors.push(`节点 id 不合法: ${n.id}`);
    if (ids.has(n.id)) errors.push(`节点 id 重复: ${n.id}`);
    if (!CLASSES.includes(n.cls)) errors.push(`未知类别: ${n.cls}（节点 ${n.id}）`);
    if (!String(n.text ?? '').trim()) errors.push(`节点 ${n.id} 的文字为空`);
    if (String(n.text ?? '').length > 120) warnings.push(`节点 ${n.id} 文字较长（${String(n.text).length} 字），建议压到 2 行以内`);
    const lines = String(n.text ?? '').split(/<br\s*\/?>/i);
    for (const line of lines) {
      if (line.length > 30) warnings.push(`节点 ${n.id} 有一行超过 30 字，可能挤压图面：${line.slice(0, 24)}…`);
    }
    checkAnswerIsolation(n.text, `节点 ${n.id}`);
    ids.add(n.id);
  }
  if (!ids.has('ROOT')) warnings.push('建议保留 id=ROOT 的题目节点，便于读图');

  // 多小问节点超过一张图的舒适区时，必须按 Q 分组；否则所有节点从 ROOT 放射，
  // 学生看到的是一团“星形”，看不出哪条条件属于哪一问。
  const groupIds = new Set();
  const groupedNodes = new Map();
  for (const g of groups) {
    if (!g || typeof g !== 'object') { errors.push('groups 里的分组必须是对象'); continue; }
    const gid = String(g.id ?? '');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(gid)) errors.push(`分组 id 不合法: ${gid}`);
    if (ids.has(gid)) errors.push(`分组 id 不能与节点 id 重名: ${gid}`);
    if (groupIds.has(gid)) errors.push(`分组 id 重复: ${gid}`);
    groupIds.add(gid);
    const list = Array.isArray(g.nodes) ? g.nodes : [];
    if (!list.length) errors.push(`分组 ${gid} 没有 nodes`);
    const label = String(g.label ?? gid);
    if (!String(g.label ?? '').trim()) warnings.push(`分组 ${gid} 缺少 label，学生看不出这一组对应哪一问`);
    checkAnswerIsolation(label, `分组 ${gid}`);
    for (const nid of list) {
      if (!ids.has(nid)) { errors.push(`分组 ${gid} 引用了不存在的节点: ${nid}`); continue; }
      if (nid === 'ROOT') { errors.push(`分组 ${gid} 不能包含 ROOT`); continue; }
      if (groupedNodes.has(nid)) errors.push(`节点 ${nid} 同时出现在分组 ${groupedNodes.get(nid)} 与 ${gid}`);
      groupedNodes.set(nid, gid);
    }
  }
  const qCount = [...ids].filter((id) => /^Q\d+$/.test(id)).length;
  const rootDegree = edges.filter((e) => e && e.from === 'ROOT').length;
  if (!groups.length && qCount >= 3 && nodes.length > 20 && rootDegree >= Math.max(8, nodes.length * 0.7)) {
    warnings.push(`图呈星形（${nodes.length} 个节点、${rootDegree} 条线从 ROOT 直接发出）。多小问题目请用 spec.groups 按 Q 分成子图，并改为 ROOT→Q→C/H/B 的层级连线`);
  }

  const edgeKeys = new Set();
  for (const e of edges) {
    if (!e || typeof e !== 'object') { errors.push('连线必须是对象'); continue; }
    if (!ids.has(e.from) || !ids.has(e.to)) errors.push(`连线引用了不存在的节点: ${e.from} -> ${e.to}`);
    if (!String(e.label ?? '').trim()) warnings.push(`连线 ${e.from} -> ${e.to} 没有触发词/相关度标签`);
    checkAnswerIsolation(e.label, `连线 ${e.from} -> ${e.to}`);
    const key = `${e.from}\u0000${e.to}\u0000${e.label ?? ''}\u0000${e.dashed ? 1 : 0}`;
    if (edgeKeys.has(key)) warnings.push(`重复连线: ${e.from} -> ${e.to}（${e.label ?? ''}）`);
    edgeKeys.add(key);
  }

  if (ids.has('ROOT')) {
    const adj = new Map([...ids].map((id) => [id, []]));
    for (const e of edges) {
      if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(e.to);
    }
    const seen = new Set(['ROOT']);
    const queue = ['ROOT'];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const unreachable = [...ids].filter((id) => !seen.has(id));
    if (unreachable.length) warnings.push(`以下节点无法从 ROOT 到达：${unreachable.join(', ')}`);
  }

  if (errors.length) {
    const err = new Error(`规格校验失败：\n- ${errors.join('\n- ')}`);
    err.errors = errors;
    err.warnings = warnings;
    throw err;
  }
  return { warnings };
}

function safeText(value, where, warnings) {
  const normalized = normalizeMathText(value);
  try {
    assertRenderableText(normalized, where);
  } catch (err) {
    err.message += `（原文：${String(value).slice(0, 80)}）`;
    throw err;
  }
  if (normalized !== String(value ?? '')) warnings.push(`${where} 已自动转换为图内可显示的 Unicode/纯文本`);
  return normalized;
}

export function buildHtmlWithReport(spec, options = {}) {
  const { warnings } = validateSpec(spec, options);
  const mermaidSrc = options.mermaidSrc || defaultMermaidSrc();
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const groups = spec.groups ?? [];
  const lines = ['flowchart LR'];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const grouped = new Set();
  const nodeLine = (n, indent = '  ') => {
    const text = safeText(n.text, `节点 ${n.id}`, warnings);
    return `${indent}${n.id}["${toMermaidLabel(text)}"]:::${n.cls}`;
  };
  // 先输出 Q 分组：每个分组就是一条小问的“条件、隐含、作答卡”子图。
  for (const g of groups) {
    const label = safeText(g.label ?? g.id, `分组 ${g.id}`, warnings);
    lines.push(`  subgraph ${g.id}["${toMermaidLabel(label)}"]`);
    for (const nid of g.nodes ?? []) {
      const n = nodeById.get(nid);
      if (!n) continue;
      grouped.add(nid);
      lines.push(nodeLine(n, '    '));
    }
    lines.push('  end');
  }
  for (const n of nodes) {
    if (grouped.has(n.id)) continue;
    lines.push(nodeLine(n));
  }
  for (const e of edges) {
    const label = safeText(e.label ?? '', `连线 ${e.from}->${e.to}`, warnings);
    const arrow = e.dashed ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow}|"${toMermaidLabel(label)}"| ${e.to}`);
  }
  lines.push(CLASS_DEFS);

  const title = escapeHtml(normalizeMathText(spec.title ?? '审题大爆炸展开图'));
  const subtitle = escapeHtml(normalizeMathText(spec.subtitle ?? ''));
  const renderMode = spec.mode ?? (/训练/.test(String(spec.title ?? '')) ? 'training' : 'explain');
  const defaultFootnote = renderMode === 'training'
    ? '审题教练 · 训练模式配图 ｜ 只在第3步揭示条件与路径，不给最终答案 ｜ 第1、2步不出图'
    : '审题教练 · 讲解模式配图 ｜ 铁律：只拆条件给路径，不给最终答案 ｜ 【二级结论】选填可直接用，解答题需先论证';
  const footnote = escapeHtml(
    normalizeMathText(
      spec.footnote ?? defaultFootnote,
    ),
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<script src="${escapeHtml(mermaidSrc)}"></script>
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
  #render-status { display: none; }
  @media (max-width: 768px) { .page-wrapper { padding: 16px 10px; } .card { padding: 16px 12px; } h1 { font-size: 18px; } }
</style>
</head>
<body>
<div class="page-wrapper">
  <div class="card" id="chart" data-chart="true">
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <div class="legend">
      <span><i class="swatch sw-root"></i>题目</span>
      <span><i class="swatch sw-cond"></i>显性条件</span>
      <span><i class="swatch sw-core"></i>隐含条件 · 核心</span>
      <span><i class="swatch sw-backup"></i>备用</span>
      <span><i class="swatch sw-disturb"></i>干扰（本题用不上）</span>
      <span><i class="swatch sw-missing"></i>缺失 · 待核实</span>
    </div>
    <pre class="mermaid">
${lines.join('\n')}
    </pre>
    <p class="footnote">${footnote}</p>
    <div id="render-status" data-status="pending">pending</div>
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
      status.textContent = 'ok';
    } catch (err) {
      status.dataset.status = 'error';
      status.textContent = String(err && err.message ? err.message : err);
    }
  })();
</script>
</body>
</html>
`;
  return { html, warnings };
}

export function buildHtml(spec, options = {}) {
  return buildHtmlWithReport(spec, options).html;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [, , specPath, outPath, ...rest] = process.argv;
  if (!specPath || !outPath) {
  console.error('用法: node build_bigbang.mjs <spec.json> <out.html> [--mermaid-src <url>] [--forbid 答案指纹]...');
    process.exit(2);
  }
  let mermaidSrc;
  const forbidTerms = [];
  for (let j = 0; j < rest.length; j++) {
    if (rest[j] === '--forbid' && rest[j + 1]) forbidTerms.push(rest[++j]);
  }
  const i = rest.indexOf('--mermaid-src');
  if (i >= 0) mermaidSrc = rest[i + 1];
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  let built;
  try {
    built = buildHtmlWithReport(spec, { mermaidSrc, forbidTerms });
  } catch (err) {
    console.error(JSON.stringify({ ok: false, status: 'invalid-spec', error: err.message, warnings: err.warnings ?? [] }));
    process.exit(2);
  }
  const { html, warnings } = built;
  await writeFile(outPath, html);
  for (const w of warnings) console.error(`警告: ${w}`);
  console.log(JSON.stringify({ ok: true, output: outPath, warnings }));
}
