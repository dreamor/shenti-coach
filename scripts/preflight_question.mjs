#!/usr/bin/env node
// 批量/单题预检：在写八模块前，把空位、小问、官方答案分段和风险点整理成机读清单。
// 用法:
//   node preflight_question.mjs <normalized.jsonl> [--jsonl-out <out.jsonl>] [--summary-out <out.json>] [--top N]
//   node preflight_question.mjs <normalized.jsonl> --id 化学-辽宁-2026-q16
import { readFile, writeFile } from 'node:fs/promises';

const [, , input, ...rest] = process.argv;
if (!input || input.startsWith('--')) {
  console.error('用法: node preflight_question.mjs <normalized.jsonl> [--jsonl-out <out.jsonl>] [--summary-out <out.json>] [--top N] [--id <id>]');
  process.exit(2);
}
const getFlag = (name, fallback = null) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const jsonlOut = getFlag('--jsonl-out');
const summaryOut = getFlag('--summary-out');
const onlyId = getFlag('--id');
const topN = Number(getFlag('--top', '40'));
const rows = (await readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const SUBQ_RE = /[（(]\s*([1-9１-９]|[ⅠⅡⅢⅣ])\s*[）)]/g;
const ANSWER_MARK_RE = /[（(]\s*([1-9１-９]|[ⅠⅡⅢⅣ])\s*[）)]/g;
const CIRCLED_RE = /[①②③④⑤⑥⑦⑧⑨⑩]/g;
const OPEN_WORDS = ['原因', '理由', '目的', '作用', '优点', '措施', '方案', '设计', '解释', '说明', '判断', '评价', '分析'];
const IMPLICIT_ANSWER_RE = /(说明|解释|分析|为什么|原因|理由|目的|作用|优点|意义|措施|建议|评价|写出|指出|简述|阐述|判断|求|证明|回答)/;
// 一个带编号小问里可能再嵌 ①②③ / a. b. 子任务；它们各自都是作答点。
// 只用于“提示人工拆分”，不直接加进 answer_slots，避免把选项 a/b/c/d 误当成子问。
const SUBITEM_MARK_RE = /(?:^|[\n。；;])\s*([①②③④⑤⑥⑦⑧⑨⑩]|[a-h])\s*[．.、:：]?\s*/g;
const SUBITEM_DEMAND_RE = /(说明|解释|分析|为什么|原因|理由|目的|作用|优点|意义|措施|建议|评价|写出|指出|简述|阐述|判断|求|证明|回答|多少|多大|多长|多高|最多|最少|最大|最小|范围|是几|为几|哪些|什么|怎样|如何|画出|作出|标出|完成|设计|提出|排序|连接|讨论|估计|推导|比较|计算|正确|错误|合理|是否|能否|方程式|反应式|结构简式|官能团|名称|化学式|离子符号|基因型|表型|现象|结论|证据)/;
const STAGE_WORDS = ['滤液', '流程', '步骤', '阶段', '蒸氨', '电解', '沉', '浸出', '转化', '还原', '氧化', '煅烧', '焙烧', '滴定'];
const ORDER_WORDS = ['顺序', '排序', '先后', '步骤', '操作', '连接', '闭合开关', '调零', '尾气', '洗涤'];
const MULTI_WORDS = ['答出两点', '答出2点', '两点即可', '两个', '分别', '至少', '各', '和', '及'];
const TYPE_HINTS = [
  [/化学式|分子式|结构简式/, '化学式/结构简式'],
  [/离子符号|离子式/, '离子符号'],
  [/化学方程式|离子方程式|方程式/, '方程式'],
  [/原因|理由|解释|说明|分析/, '原因/解释'],
  [/目的|作用|优点|措施/, '目的/作用/措施'],
  [/顺序|排序|先后/, '顺序/排序'],
  [/数值|浓度|物质的量|体积|质量|产率|速率|pH|mol/, '数值/量'],
  [/标号|字母|选填|填“/, '标号/选择'],
  [/是否|能否|判断/, '判断/是否'],
];
const NUMBERED_ROMAN = { 'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4' };
const normLabel = (s) => s.translate?.('１２３４５６７８９', '123456789') ?? s;

function splitAnswer(answer) {
  const text = String(answer ?? '').trim();
  if (!text) return { groups: [], chunks: 0 };
  const marks = [...text.matchAll(ANSWER_MARK_RE)];
  const groups = [];
  if (marks.length) {
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      groups.push({ label: marks[i][1], text: text.slice(marks[i].index + marks[i][0].length, end).trim() });
    }
  } else {
    groups.push({ label: '', text });
  }
  let chunks = 0;
  for (const g of groups) {
    const circled = [...g.text.matchAll(CIRCLED_RE)].length;
    if (circled >= 2) chunks += circled;
    else chunks += g.text.split(/[；;]/).filter((x) => x.trim()).length || 1;
  }
  return { groups, chunks };
}

function inferType(text) {
  for (const [re, label] of TYPE_HINTS) if (re.test(text)) return label;
  return '待核实';
}

function buildMatrix(row) {
  const details = row.subquestion_details ?? [];
  const total = Number(row.blank_count ?? 0);
  const matrix = [];
  if (details.length) {
    let cursor = 0;
    for (const d of details) {
      for (let i = 0; i < (d.blanks ?? 0); i++) {
        cursor += 1;
        matrix.push({ b: `B${cursor}`, q: `Q${normLabel(d.label)}`, hint: d.text.slice(0, 100), type: inferType(d.text) });
      }
    }
    if (cursor < total) {
      for (let i = cursor + 1; i <= total; i++) matrix.push({ b: `B${i}`, q: '题首/未归类', hint: '', type: '待核实' });
    }
  } else {
    for (let i = 1; i <= total; i++) matrix.push({ b: `B${i}`, q: '无小问编号', hint: '', type: inferType(row.stem ?? '') });
  }
  return matrix;
}

function countDemandSubItems(text) {
  const marks = [...String(text ?? '').matchAll(SUBITEM_MARK_RE)];
  if (marks.length < 2) return 0;
  let n = 0;
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = text.slice(marks[i].index + marks[i][0].length, end).trim();
    if (body && SUBITEM_DEMAND_RE.test(body)) n += 1;
  }
  return n;
}

function audit(row) {
  const stem = String(row.stem ?? '');
  const answer = String(row.official_answer ?? row.answer ?? '');
  const { groups, chunks } = splitAnswer(answer);
  const total = Number(row.blank_count ?? 0);
  const details = row.subquestion_details ?? [];
  const mapped = details.reduce((n, d) => n + (d.blanks ?? 0), 0);
  const implicitSlots = details.flatMap((d) => {
    if ((d.blanks ?? 0) !== 0) return [];
    const text = String(d.text ?? '');
    // 规范化的 subquestion_details 里，每个带编号小问本身就是作答点：
    // 即使没有“求/说明/判断”等触发词（如“$a$ 的值；”“图2结果说明……”），
    // 也不能因为词表没命中就漏掉。词表只用于判断是否需要拆成“判断+理由”。
    if (!text.trim()) return [];
    const q = `Q${normLabel(d.label)}`;
    // 判断 + 说明理由：判断与理由是两个作答点（playbook §5.5）。
    if (/判断|能否|是否/.test(text) && /说明理由|说明原因|并说明/.test(text)) {
      return [
        { q, hint: text.slice(0, 100), kind: '判断' },
        { q, hint: text.slice(0, 100), kind: '理由' },
      ];
    }
    return [{ q, hint: text.slice(0, 100), kind: '作答' }];
  });
  const answerSlots = total + implicitSlots.length;
  const risks = [];
  if (total >= 7) risks.push('high_blank_count');
  if (details.length >= 5) risks.push('high_multipart');
  if (total && chunks < total) risks.push('answer_segmentation_short');
  if (total >= 2 && !details.length) risks.push('multi_blank_no_subq_marker');
  if (total && details.length && mapped < total) risks.push('unmapped_blank');
  if (total && OPEN_WORDS.some((w) => stem.includes(w))) risks.push('open_answer_blank');
  if (total && STAGE_WORDS.some((w) => stem.includes(w))) risks.push('stage_boundary');
  if (total && ORDER_WORDS.some((w) => stem.includes(w))) risks.push('order_boundary');
  if (total && MULTI_WORDS.some((w) => stem.includes(w))) risks.push('multi_point_blank');
  if ((row.warnings ?? []).some((w) => /图|图片/.test(w))) risks.push('figure_mismatch');
  if ((row.warnings ?? []).some((w) => /残留空位/.test(w))) risks.push('stray_blank_marker');
  if (implicitSlots.length) risks.push('implicit_answer_slot');
  if (details.some((d) => (d.blanks ?? 0) === 0 && countDemandSubItems(d.text ?? '') >= 2)) {
    risks.push('implicit_multi_item');
  }
  if (row.kind === 'free_with_embedded_options') risks.push('embedded_options_ownership');
  if (row.warnings?.length) risks.push('input_warning');
  if (!answer.trim()) risks.push('missing_official_answer');
  const score = answerSlots * 3 + details.length * 2 + risks.length * 2 + (risks.includes('stage_boundary') ? 8 : 0) + (risks.includes('open_answer_blank') ? 5 : 0);
  return {
    id: `${row.subject}-${row.region}-${row.year}-q${row.seq}`,
    subject: row.subject,
    region: row.region,
    year: row.year,
    seq: row.seq,
    kind: row.kind,
    type: row.type,
    blanks: total,
    answer_slots: answerSlots,
    implicit_answer_slots: implicitSlots,
    subquestions: details.length,
    blank_map: row.blank_map ?? [],
    answer_groups: groups.map((g) => ({ label: g.label, text: g.text })),
    answer_chunks_estimate: chunks,
    blank_matrix: buildMatrix(row),
    risks,
    warnings: row.warnings ?? [],
    risk_score: score,
    stem_head: stem.replace(/\s+/g, ' ').slice(0, 120),
  };
}

const audited = rows.map(audit).filter((x) => !onlyId || x.id === onlyId);
if (jsonlOut) await writeFile(jsonlOut, audited.map((x) => JSON.stringify(x)).join('\n') + '\n');
const riskCounts = {};
for (const item of audited) for (const r of item.risks) riskCounts[r] = (riskCounts[r] ?? 0) + 1;
const top = [...audited].sort((a, b) => b.risk_score - a.risk_score || a.id.localeCompare(b.id)).slice(0, topN);
const summary = {
  ok: true,
  total: audited.length,
  with_blanks: audited.filter((x) => x.blanks).length,
  total_blanks: audited.reduce((n, x) => n + x.blanks, 0),
  risk_counts: riskCounts,
  top: top.map((x) => ({ id: x.id, blanks: x.blanks, subquestions: x.subquestions, risks: x.risks, score: x.risk_score })),
};
if (summaryOut) await writeFile(summaryOut, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
