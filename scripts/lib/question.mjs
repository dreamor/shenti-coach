// 题库输入规范化：把不同年份/地区的 options/images 形态整理成技能可消费的统一结构。
// 保留旧归档字段；讲解输入必须使用无答案/路径的 allowlist 投影。仅在宿主 publicRoot 内探测图件。

import fs from 'node:fs';
import path from 'node:path';
import { assertInputData, buildInputViews, renderInputPrompt } from './input-boundary.mjs';

export { buildInputViews } from './input-boundary.mjs';

const LABELS = 'ABCDEFGH';

function asArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      assertInputData(parsed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return [s];
    }
  }
  return [value];
}

function splitOptionString(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const matches = [...raw.matchAll(/([A-H])\s*[.．、:：]\s*/g)];
  if (matches.length && !raw.slice(0, matches[0].index).trim()) {
    return matches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
      return `${m[1]}. ${raw.slice(start, end).trim()}`;
    });
  }
  // 仅顶层无标记字符串保留“每行一个选项”的旧输入兼容。
  return raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function parseOptionItem(item, index) {
  const fallbackLabel = LABELS[index] ?? String(index + 1);
  if (item && typeof item === 'object') {
    const label = String(item.label ?? item.key ?? item.letter ?? fallbackLabel).replace(/[.．、:：\s]/g, '').toUpperCase();
    const text = item.text ?? item.content ?? item.value ?? '';
    const images = asArray(item.image ?? item.images ?? item.img).filter(Boolean);
    return { label: label || fallbackLabel, text: String(text), images, raw: item };
  }
  const raw = String(item ?? '').trim();
  const m = /^([A-Ha-h])\s*[.．、:：]\s*(.*)$/s.exec(raw);
  if (m) return { label: m[1].toUpperCase(), text: m[2].trim(), images: [], raw: item };
  return { label: fallbackLabel, text: raw, images: [], raw: item };
}

export function parseOptions(raw) {
  assertInputData(raw);
  if (raw == null || raw === '') return { format: 'none', options: [] };
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = splitOptionString(raw); }
  }
  assertInputData(value);
  if (Array.isArray(value)) {
    // 数组元素本身就是选项；换行是续行，不能再拆分或重置后续编号。
    const options = value.map((item, i) => parseOptionItem(item, i));
    return { format: value.every((x) => typeof x === 'string') ? 'list' : 'list-object', options };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([k]) => k !== '__raw__');
    return {
      format: 'dict',
      options: entries.map(([label, item], i) => {
        if (item && typeof item === 'object') {
          return parseOptionItem({ ...item, label }, i);
        }
        return { label: String(label).toUpperCase(), text: String(item ?? ''), images: [], raw: item };
      }),
    };
  }
  return { format: 'unknown', options: [] };
}

export function classifyType(type, stem = '', options = []) {
  const t = String(type ?? '');
  if (/非选择/.test(t)) {
    if (options.length) return 'free_with_embedded_options';
    return /实验/.test(t) ? 'experiment' : /计算|解答|证明/.test(t) ? 'solution' : 'free';
  }
  if (/多选|多项选择/.test(t)) return 'multi_choice';
  if (/单选|单项选择/.test(t)) return 'choice';
  if (/选择/.test(t)) return 'choice';
  if (/填空/.test(t)) return 'fill';
  if (/实验/.test(t)) return 'experiment';
  if (/计算|解答|证明/.test(t)) return 'solution';
  if (options.length) return 'free_with_embedded_options';
  return 'free';
}

function collectTopImages(q) {
  return asArray(q.images ?? q.image ?? q.figures)
    .map((x) => (x && typeof x === 'object' ? x.path ?? x.src ?? x.url : x))
    .filter(Boolean)
    .map(String);
}

function toAbsoluteImage(p, publicRoot) {
  // Source paths are references, not authority to access URLs or files outside
  // the caller-owned public root. Keep the original only in the private view.
  if (typeof p !== 'string' || !p || /[\u0000-\u001f\\]/.test(p) || /^[a-z][a-z\d+.-]*:/i.test(p) || p.startsWith('//')) return null;
  const root = path.resolve(publicRoot);
  const absolutePath = path.resolve(root, p.replace(/^\//, ''));
  const relative = path.relative(root, absolutePath);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : absolutePath;
}

function publicImageExists(absolutePath, publicRoot) {
  if (!absolutePath) return false;
  const root = path.resolve(publicRoot);
  const parts = path.relative(root, absolutePath).split(path.sep).filter(Boolean);
  let current = root;
  try {
    // Never follow a source-selected symlink to escape the host root.
    for (let i = 0; i < parts.length; i += 1) {
      current = path.join(current, parts[i]);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) return false;
    }
    return parts.length > 0;
  } catch {
    return false;
  }
}

function countPlaceholders(stem) {
  return [...String(stem ?? '').matchAll(/\[图\]|【图】|\[image\]|\[img\]/gi)].length;
}

function countBlanks(text) {
  return [...String(text ?? '').matchAll(/_{2,}|＿{2,}/g)].length;
}

function labelNumber(label) {
  const roman = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4 };
  return roman[label] ?? Number(label);
}

// 只把小问“起始标记”当作小问边界：
// - 必须位于句首/换行/句末标点之后（排除“回答（1）～（4）题”“见（1）中”这类引用）；
// - 编号必须按 1,2,3… 递增（排除正文里重复出现的交叉引用和 (Ⅱ) 这类元素价态）。
// 数学公式里的 $f(1)$、$a_n(2)$ 不能当小问编号：先算出 $...$ 区间，
// 编号命中区间内一律跳过。否则宽松模式会把 "$f(x)$…$f(1)$\"的" 切成
// 小问 Q1 = '"$的'（全库 2 题实测）。
function mathRanges(text) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '$') {
      if (start < 0) start = i;
      else { ranges.push([start, i]); start = -1; }
    }
  }
  return ranges;
}

function findSubquestionMatches(text, { loose = false } = {}) {
  const raw = [...String(text ?? '').matchAll(/[（(]\s*([1-9１-９]|[ⅠⅡⅢⅣ])\s*[）)]/g)];
  const ranges = mathRanges(text);
  const inMath = (idx) => ranges.some(([a, b]) => idx > a && idx < b);
  const out = [];
  let expected = 1;
  for (const m of raw) {
    if (inMath(m.index)) continue;
    const label = m[1].replace(/[１-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const num = labelNumber(label);
    const prev = text[m.index - 1] ?? '';
    const prev2 = text.slice(Math.max(0, m.index - 2), m.index);
    // 函数记号 f(1)、下标 a(2)、LaTeX 命令后紧跟的括号都不是小问起点。
    if (/[A-Za-z0-9_$\\]/.test(prev)) continue;
    const boundary = m.index === 0 || /[\s\n。；;：:？！]/.test(prev) || prev2 === '\\n';
    if (!boundary && !loose) continue;
    if (num !== expected) continue;
    out.push({ ...m, label });
    expected += 1;
  }
  return out;
}

// 严格模式（句首/换行/句末标点后）找不到任何小问时，才启用宽松模式：
// 允许编号紧跟在汉字后（如表格行末“...提取物（1）据图分析...”），
// 但仍要求编号从 1 开始连续递增，避免把“回答（1）～（4）题”这类引用当成小问。
function findBestSubquestionMatches(text) {
  const strict = findSubquestionMatches(text);
  if (strict.length) return { matches: strict, loose: false };
  const loose = findSubquestionMatches(text, { loose: true });
  return { matches: loose, loose: loose.length > 0 };
}

function extractSubquestions(stem) {
  return findBestSubquestionMatches(String(stem ?? '')).matches.map((m) => m.label);
}

function extractSubquestionDetails(stem) {
  const text = String(stem ?? '');
  const { matches, loose } = findBestSubquestionMatches(text);
  if (!matches.length) return [];
  // 小问编号之前的导语/步骤里也可能有下划线（如“步骤①……______端”，随后 Q1 追问“步骤①应置于哪端”）。
  // 这类前置空位默认归入 Q1，并单独记录 preamble_blanks，供输出时人工核对，避免出现“未归类 B 号”。
  const preamble = text.slice(0, matches[0].index);
  const preambleBlanks = countBlanks(preamble);
  return matches.map((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(m.index + m[0].length, end).trim();
    return {
      label: m.label,
      text: body,
      blanks: countBlanks(body) + (i === 0 ? preambleBlanks : 0),
      preamble_blanks: i === 0 ? preambleBlanks : 0,
      ...(loose ? { loose_boundary: true } : {}),
    };
  });
}

export function normalizeQuestion(q, options = {}) {
  assertInputData(q);
  assertInputData(options);
  if (!q || typeof q !== 'object' || Array.isArray(q) || !options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Question and host options must be records');
  const publicRoot = options.publicRoot ?? 'public';
  const warnings = [];
  const notes = [];
  const stem = String(q.stem ?? '').trim();
  const type = String(q.type ?? '').trim();
  const parsed = parseOptions(q.options);
  const kind = classifyType(type, stem, parsed.options);
  const isChoice = ['choice', 'multi_choice'].includes(kind);
  const topImagesRaw = collectTopImages(q);
  const optionImagePaths = parsed.options.flatMap((o) => o.images).filter(Boolean);
  const optionImageSet = new Set(optionImagePaths);

  // 顶层 images 可能同时包含题干图与选项图。按选项图路径扣除，其余归到题干。
  const stemImagesRaw = topImagesRaw.filter((p) => !optionImageSet.has(p));
  const figures = [];
  for (const p of stemImagesRaw) {
    figures.push({ id: `G${figures.length + 1}`, path: p, absolutePath: toAbsoluteImage(p, publicRoot), role: 'stem' });
  }
  for (const o of parsed.options) {
    for (const p of o.images) {
      figures.push({ id: `G${figures.length + 1}`, path: p, absolutePath: toAbsoluteImage(p, publicRoot), role: 'option', option: o.label });
    }
  }
  // 顶层 images 里未被归入题干/选项的图片，补成题干图（有些旧数据把选项图放顶层）。
  for (const p of topImagesRaw) {
    if (!figures.some((f) => f.path === p)) {
      figures.push({ id: `G${figures.length + 1}`, path: p, absolutePath: toAbsoluteImage(p, publicRoot), role: 'stem' });
    }
  }

  if (!stem) warnings.push('题干为空');
  if (isChoice && !parsed.options.length) warnings.push('题型为选择题，但未解析出选项');
  if (!isChoice && parsed.options.length) warnings.push('非选择题含 options 字段；多为某一小问的选项，不能当作整题选项');
  if (parsed.format === 'unknown') warnings.push('options 字段格式无法识别');
  if (parsed.options.length > 8) warnings.push(`选项 ${parsed.options.length} 个，超过常规 4 个；请确认是否为多小问选项`);
  const placeholderCount = countPlaceholders(stem);
  if (placeholderCount > 0 && stemImagesRaw.length === 0 && optionImagePaths.length === 0) {
    warnings.push(`题干有 ${placeholderCount} 处图位，但未找到图片路径`);
  }
  if (stemImagesRaw.length && placeholderCount && stemImagesRaw.length !== placeholderCount) {
    warnings.push(`题干图位 ${placeholderCount} 处，题干图 ${stemImagesRaw.length} 张，数量不一致`);
  }
  // 题面按“图1/图2…”指名引用，但图件数不足：多为一张合图内含多面板，需人工核对分区。
  const namedFigRefs = [...stem.matchAll(/图\s*([1-9]\d?)/g)].map((m) => Number(m[1]));
  if (namedFigRefs.length) {
    const maxRef = Math.max(...namedFigRefs);
    if (maxRef > figures.length) {
      warnings.push(`题面提到图1–图${maxRef}，但只解析出 ${figures.length} 个图件；可能是合图或数据缺失，请按图中分区核对（待核实）`);
    }
  }
  // 末尾“已含空位的完整句 + 又一个孤立下划线”：多为题库残留标记，不是新作答点。
  if (/_{2,}[^。\n]{0,16}。\s*_{2,}\s*[。；;]?\s*$/.test(stem)) {
    warnings.push('疑似残留空位：最后一个下划线前是已含空位的完整句，且其后无设问；请核对是否应删除（待核实）');
  }
  if (topImagesRaw.length && !placeholderCount && !parsed.options.some((o) => o.images.length)) {
    warnings.push('有图片但题干没有 [图] 占位；请按图片内容补 G 编号');
  }
  for (const f of figures) {
    if (!f.absolutePath) warnings.push(`图片路径未获宿主 publicRoot 范围授权（待核实）：${f.id}`);
    else if (!publicImageExists(f.absolutePath, publicRoot)) warnings.push(`图片文件不存在或为未授权符号链接：${f.absolutePath}`);
  }
  const subquestions = extractSubquestions(stem);
  const subquestionDetails = extractSubquestionDetails(stem);
  // 残留空位不计入作答点：最后一个孤立下划线前已是含空位的完整句。
  const strayBlankDetected = /_{2,}[^。\n]{0,16}。\s*_{2,}\s*[。；;]?\s*$/.test(stem);
  if (strayBlankDetected) {
    const last = subquestionDetails[subquestionDetails.length - 1];
    if (last && Number(last.blanks) > 0) {
      last.blanks = Number(last.blanks) - 1;
      last.stray_blank_removed = true;
    }
  }
  const blankCount = Math.max(0, countBlanks(stem) - (strayBlankDetected ? 1 : 0));
  const mappedBlanks = subquestionDetails.reduce((n, s) => n + s.blanks, 0);
  if (subquestions.length) notes.push(`含 ${subquestions.length} 个小问：${subquestions.join('、')}`);
  if (subquestionDetails.some((s) => s.loose_boundary)) {
    notes.push('小问编号未落在句首/换行处，已按“1→2→3 连续递增”宽松识别；请人工核对小问边界（待核实）');
  }
  if (blankCount) notes.push(`题面共 ${blankCount} 个空位${subquestions.length ? `；按小问分布为 ${subquestionDetails.map((s) => `Q${s.label}:${s.blanks}`).join('，')}` : ''}`);
  if (blankCount >= 2 && !subquestions.length) {
    notes.push('题面有多个空但无小问编号；按题面从左到右顺序编 B1…Bn，不得合并。');
  }
  const preambleBlanks = subquestionDetails[0]?.preamble_blanks || 0;
  if (preambleBlanks > 0) {
    warnings.push(`小问编号前有 ${preambleBlanks} 个空位，已暂归 Q1（常见于“步骤①……____”再由 Q1 追问）；请按原文核对空位归属`);
  }
  if (blankCount && subquestions.length && mappedBlanks < blankCount) {
    warnings.push(`题面 ${blankCount} 个空位，但小问分段只统计到 ${mappedBlanks} 个；可能有空位在小问编号之前，或题面换行异常，需按原文逐空核对`);
  }

  const kps = asArray(q.knowledge_points ?? q.knowledgePoints ?? q.kps ?? [])
    .map((k) => (k && typeof k === 'object' ? [k.code, k.name].filter(Boolean).join(' ') : String(k)))
    .filter(Boolean);

  const normalized = {
    id: q.id,
    subject: q.subject,
    region: q.region,
    year: q.year,
    seq: q.seq,
    type,
    kind,
    stem,
    options: parsed.options,
    options_format: parsed.format,
    figures,
    subquestions,
    subquestion_details: subquestionDetails,
    blank_count: blankCount,
    blank_map: subquestionDetails.map((s) => ({ label: s.label, blanks: s.blanks })),
    knowledge_points: kps,
    official_answer: String(q.answer ?? ''),
    solution: String(q.solution ?? q.analysis ?? ''),
    warnings,
    notes,
    // Retain source OCR/web/image metadata privately; never infer controls from it.
    input_sources: Object.fromEntries(['ocr', 'ocr_text', 'rawweb', 'raw_web', 'web', 'images', 'image', 'figures'].filter((key) => Object.hasOwn(q, key)).map((key) => [key, structuredClone(q[key])])),
  };
  const views = buildInputViews(normalized, { mode: options.mode ?? 'explain' });
  normalized.input_boundary = views.boundary;
  normalized.prompt_markdown = renderInputPrompt(views, { includeAnswer: options.includeAnswer, includeSolution: options.includeSolution, analysis: String(q.analysis ?? '') });
  assertInputData(normalized); // Also bound encoded output; every returned record can be safely re-projected.
  return normalized;
}

export function normalizeMany(questions, options = {}) {
  // Apply limits per question, not to a legitimate full-library batch.
  if (!Array.isArray(questions)) throw new TypeError('Questions must be an input data list');
  return questions.map((q) => normalizeQuestion(q, options));
}
