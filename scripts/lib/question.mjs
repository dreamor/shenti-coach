// 题库输入规范化：把不同年份/地区的 options/images 形态整理成技能可消费的统一结构。
// 纯函数，便于单测；不读取答案作为讲解输入。

import fs from 'node:fs';
import path from 'node:path';

const LABELS = 'ABCDEFGH';

function asArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [s];
    }
  }
  return [value];
}

function splitOptionString(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n|(?=\s*[A-H][.．、:：])/).map((x) => x.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const matches = [...raw.matchAll(/(?:^|\s)([A-H])[.．、:：]\s*/g)];
  if (matches.length >= 2) {
    return matches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
      return `${m[1]}. ${raw.slice(start, end).trim()}`;
    });
  }
  return [raw];
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
  if (raw == null || raw === '') return { format: 'none', options: [] };
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = splitOptionString(raw); }
  }
  if (Array.isArray(value)) {
    const options = value.flatMap((item, i) => {
      if (typeof item === 'string') {
        const parts = splitOptionString(item);
        return parts.length > 1 ? parts.map((p, j) => parseOptionItem(p, j)) : [parseOptionItem(item, i)];
      }
      return [parseOptionItem(item, i)];
    });
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
  if (!p) return p;
  if (/^file:\/\//.test(p)) return p;
  if (p.startsWith('/')) return path.join(publicRoot, p.slice(1));
  if (path.isAbsolute(p)) return p;
  return path.join(publicRoot, p);
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
  const topImageSet = new Set(topImagesRaw);
  const optionImageSet = new Set(optionImagePaths);

  // 顶层 images 可能同时包含题干图与选项图。按选项图路径扣除，其余归到题干。
  const stemImagesRaw = topImagesRaw.filter((p) => !optionImageSet.has(p));
  const allImages = [...new Set([...stemImagesRaw, ...optionImagePaths, ...topImagesRaw])];
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
    if (!fs.existsSync(f.absolutePath)) warnings.push(`图片文件不存在：${f.absolutePath}`);
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

  const promptParts = [];
  promptParts.push(`# 题目 ${q.subject ?? ''} ${q.region ?? ''} ${q.year ?? ''} 第${q.seq ?? '?'}题`);
  promptParts.push(`- 学科：${q.subject ?? '待识别'}`);
  promptParts.push(`- 地区/年份：${q.region ?? '未注明'} / ${q.year ?? '未注明'}`);
  promptParts.push(`- 题号/题型：${q.seq ?? '?'} / ${type || '未注明'}（规范化：${kind}）`);
  if (kps.length) promptParts.push(`- 知识标签（定位用，不当作已核实结论）：${kps.join('；')}`);
  promptParts.push('', '## 题干', '', stem || '（空）');
  if (isChoice && parsed.options.length) {
    promptParts.push('', '## 选项');
    for (const o of parsed.options) {
      const ids = figures.filter((f) => f.role === 'option' && f.option === o.label).map((f) => f.id);
      const imgs = ids.length ? `  ［配图：${ids.join('、')}］` : '';
      promptParts.push(`- ${o.label}. ${o.text}${imgs}`);
    }
  } else if (!isChoice && parsed.options.length) {
    promptParts.push('', '## 题内嵌选项（属于某一小问，勿当作整题选项）');
    for (const o of parsed.options) {
      const ids = figures.filter((f) => f.role === 'option' && f.option === o.label).map((f) => f.id);
      const imgs = ids.length ? `  ［配图：${ids.join('、')}］` : '';
      promptParts.push(`- ${o.label}. ${o.text}${imgs}`);
    }
  }
  if (figures.length) {
    promptParts.push('', '## 图形清单（按顺序对应题面 [图]）');
    for (const f of figures) {
      promptParts.push(`- ${f.id}｜${f.role === 'option' ? `选项${f.option}图` : '题干图'}｜${f.absolutePath}`);
    }
  }
  if (subquestions.length) promptParts.push('', `## 小问清单：${subquestions.join('、')}`);
  if (blankCount) {
    promptParts.push('', '## 空白清单（机读预检，写入输出前必须逐空核对）');
    promptParts.push(`- 总空位：${blankCount} 个；编号 B1–B${blankCount}，一空一 B。`);
    if (subquestions.length) {
      promptParts.push('', '| 小问 | 本问空位数 | 对应 B 号（按题面顺序） |', '| --- | ---: | --- |');
      let cursor = 0;
      for (const s of subquestionDetails) {
        const ids = Array.from({ length: s.blanks }, (_, i) => `B${cursor + i + 1}`);
        cursor += s.blanks;
        promptParts.push(`| Q${s.label} | ${s.blanks} | ${ids.join('、') || '无'} |`);
      }
      if (mappedBlanks < blankCount) {
        promptParts.push(`| 小问编号前/未归类 | ${blankCount - mappedBlanks} | B${mappedBlanks + 1}–B${blankCount}（按原文位置核对） |`);
      }
    } else {
      promptParts.push(`- 无小问编号：按题面从左到右依次编 B1…B${blankCount}。`);
    }
  }
  if (warnings.length) {
    promptParts.push('', '## 输入提示（先核对，不猜测）');
    for (const w of warnings) promptParts.push(`- ${w}`);
  }
  if (notes.length) {
    promptParts.push('', '## 结构说明');
    for (const n of notes) promptParts.push(`- ${n}`);
  }
  if (options.includeAnswer) {
    promptParts.push('', '## 答案/解析（仅“解题模式”可用；讲解模式不得读取）', '', String(q.answer ?? ''), '', String(q.analysis ?? ''));
  }
  if (options.includeSolution) {
    const officialAnswer = String(q.answer ?? '').trim();
    promptParts.push(
      '',
      '## 官方答案（仅用于核对 B 号、答案指纹与阶段边界；不得抄进讲解正文）',
      '',
      officialAnswer || '（无独立答案字段）',
      '',
      '## 官方解析（仅用于核对 B 号、答案指纹与阶段边界；不得抄进讲解正文）',
      '',
      String(q.solution ?? q.analysis ?? q.answer ?? '（无）'),
    );
  }

  return {
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
    prompt_markdown: promptParts.join('\n'),
  };
}

export function normalizeMany(questions, options = {}) {
  return questions.map((q) => normalizeQuestion(q, options));
}
