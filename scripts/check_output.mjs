#!/usr/bin/env node
// 审题输出结构自检（启发式，不替代人工）
// 用法: node check_output.mjs <output.md> [--mode explain|training] [--type choice|fill|solution|calculation|experiment|proof|mixed]
//        [--blanks N] [--answer-slots N] [--q-count N] [--answer 答案指纹]... [--require-media]
//        [--require-blank-map] [--strict-answer] [--solution] [--semantic-reviewed] [--strict-semantic] [--json]

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateTraining } from './training_state.mjs';
import { validateDeliveryManifest } from './lib/delivery.mjs';

const [, , file, ...rest] = process.argv;
if (!file || file.startsWith('--')) {
  console.error('用法: node check_output.mjs <output.md> [--mode explain|training] [--type ...] [--blanks N] [--answer-slots N] [--q-count N] [--answer 答案指纹]... [--require-media] [--require-blank-map] [--strict-answer] [--solution] [--semantic-reviewed] [--strict-semantic] [--json]');
  process.exit(2);
}

const argumentError = (message) => {
  console.error(message);
  process.exit(2);
};
const valueFlags = new Set(['--mode', '--type', '--blanks', '--answer-slots', '--q-count', '--answer', '--training-state', '--student', '--question', '--delivery', '--delivery-manifest', '--presentation']);
const booleanFlags = new Set(['--require-media', '--require-blank-map', '--strict-answer', '--solution', '--semantic-reviewed', '--strict-semantic', '--json']);
const values = new Map();
const flags = new Set();
const answerTerms = [];
for (let i = 0; i < rest.length; i++) {
  const name = rest[i];
  if (valueFlags.has(name)) {
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) argumentError(`参数 ${name} 缺少值`);
    if (!value.trim()) argumentError(`参数 ${name} 的值不能为空`);
    if (name === '--answer') answerTerms.push(value);
    else if (!values.has(name)) values.set(name, value);
  } else if (booleanFlags.has(name)) {
    flags.add(name);
  } else {
    argumentError(`未知参数：${name}`);
  }
}
const getFlag = (name, fallback) => values.has(name) ? values.get(name) : fallback;
const hasFlag = (name) => flags.has(name);
const getCount = (name, fallback = null) => {
  const raw = getFlag(name, null);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) argumentError(`参数 ${name} 必须是非负安全整数`);
  return value;
};
const mode = getFlag('--mode', 'explain');
if (!['explain', 'training'].includes(mode)) argumentError('--mode 只能是 explain 或 training');
const type = getFlag('--type', 'mixed');
const blanks = getCount('--blanks');
const answerSlots = getCount('--answer-slots', blanks);
const qCount = getCount('--q-count');
const requireMedia = hasFlag('--require-media');
const requireBlankMap = hasFlag('--require-blank-map');
const strictAnswer = hasFlag('--strict-answer');
const solutionMode = hasFlag('--solution');
const semanticReviewed = hasFlag('--semantic-reviewed');
const strictSemantic = hasFlag('--strict-semantic');
const jsonMode = hasFlag('--json');
if (strictAnswer && !answerTerms.length) argumentError('--strict-answer 必须提供至少一个非空 --answer 答案指纹');
const readControlJson = async (filename, label) => {
  try {
    const raw = await readFile(filename, 'utf8');
    if (raw.length > 1_000_000) throw new Error('too large');
    return JSON.parse(raw);
  } catch {
    argumentError(`${label} 必须是可读取、大小合规的 JSON 文件`);
  }
};
const delivery = getFlag('--delivery', 'media');
if (!['media', 'markdown', 'file'].includes(delivery)) argumentError('--delivery 只能是 media、markdown 或 file');
const manifestPath = getFlag('--delivery-manifest', null);
if (delivery !== 'media' && !manifestPath) argumentError('非 MEDIA 交付必须提供 --delivery-manifest');
let deliveryManifest = null;
if (manifestPath) {
  deliveryManifest = await readControlJson(manifestPath, '交付清单');
  try { validateDeliveryManifest(deliveryManifest); } catch { argumentError('交付清单无效或图片不存在'); }
  if (deliveryManifest.mode !== delivery) argumentError('交付清单模式与 --delivery 不一致');
}
const trainingStatePath = getFlag('--training-state', null);
let trainingState = null;
if (trainingStatePath) {
  if (mode !== 'training') argumentError('--training-state 仅用于 training 模式的当前轮次校验');
  if (requireMedia && !manifestPath) argumentError('自适应训练强制图片时需提供 --delivery-manifest 验证实际产物');
  const raw = await readControlJson(trainingStatePath, '训练状态');
  trainingState = raw.state ?? raw;
  try { validateTraining(trainingState); } catch { argumentError('训练状态无效，必须来自可重放的状态机'); }
  if (!getFlag('--student', null) || !getFlag('--question', null)) argumentError('自适应训练需明确 --student 与 --question');
  if (trainingState.student_id !== getFlag('--student', null) || trainingState.question_id !== getFlag('--question', null)) {
    argumentError('训练状态与当前学生/题次不匹配');
  }
}
const text = await readFile(file, 'utf8');
const presentationPath = getFlag('--presentation', null);
let presentationText = null;
if (presentationPath) {
  if (mode === 'training') argumentError('学生展示与完整审计配对时使用 explain；训练当前轮次单独校验');
  try { presentationText = await readFile(presentationPath, 'utf8'); } catch { argumentError('学生展示文件不可读取'); }
  if (presentationText.length > 1_000_000) argumentError('学生展示文件过大');
}
const hasDeliveryReference = (part) => {
  if (!deliveryManifest) return /^MEDIA:\S+/m.test(part);
  if (deliveryManifest.status === 'unavailable' || !deliveryManifest.path || !deliveryManifest.reference) return false;
  return part.includes(deliveryManifest.reference) || part.includes(deliveryManifest.path)
    || part.includes(pathToFileURL(deliveryManifest.path).href);
};
const fail = [];
const warn = [];
const ok = [];

const has = (re) => re.test(text);
const add = (name, pass, detail, level = 'fail') => {
  const line = pass
    ? `PASS ${name}`
    : `${level === 'warn' ? 'WARN' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`;
  (pass ? ok : level === 'warn' ? warn : fail).push(line);
};
const count = (re) => [...text.matchAll(re)].length;
const firstMissingNumbers = (total, present) => {
  const ids = new Set(present);
  const missing = [];
  for (let n = 1; n <= total && missing.length < 20; n++) {
    if (!ids.has(n)) missing.push(n);
  }
  return missing;
};
if (strictSemantic && !semanticReviewed) {
  add('语义人工复核', false, '使用 --strict-semantic 时必须同时声明 --semantic-reviewed；自动闸门不能证明条件语义正确');
}

const getSolutionBoundaries = (source) => [...source.matchAll(/^[ \t]*(?:#+[ \t]*)?(?:(完整解答|完整解析|解题过程|解答)\s*$|〇[、.．])/gm)];
const solutionBoundaries = getSolutionBoundaries(text);
const fullSolutionAt = solutionBoundaries.find((m) => m[1])?.index ?? -1;
const isAfterFullSolution = (index, boundaries = solutionBoundaries) => {
  if (mode !== 'explain' || !solutionMode) return false;
  let inSolution = false;
  for (const boundary of boundaries) {
    if (boundary.index > index) break;
    inSolution = Boolean(boundary[1]);
  }
  return inSolution;
};

// 答案指纹里如果出现 C5/H2/B1 这类编号形态，会和正文条件编号撞车。
// 只遮蔽“明显作为编号使用”的上下文（表格单元格、由 C5 引用、C1–C6 区间、树节点前缀），
// 句子里的独立出现仍然按泄题处理。
const ID_SHAPE = /^[A-Z]\d+$/;
const isStructuralIdOccurrence = (s, idx, term) => {
  if (!ID_SHAPE.test(term)) return false;
  const before = s.slice(Math.max(0, idx - 12), idx);
  const after = s.slice(idx + term.length, idx + term.length + 6);
  if (/(?:^|\n)\s*\|\s*$/.test(before) && /^\s*\|/.test(after)) return true;
  if (/(?:^|\n)\s*(?:[├└│─]\s*)+$/.test(before)) return true;
  if (/(?:由|见|据|按|结合|对照|对应|引用|来源[:：]?|条件|编号)\s*$/.test(before)) return true;
  if (/[、，,–—-]\s*$/.test(before) && /^(?:\s*[、，,–—-]|\s*[A-Z]\d+|[\s|）)、，,；;])/.test(after)) return true;
  if (/^\s*(?:、|，|,|–|-|—|\/|的|行|表|条件|触发|编号|[:：])/.test(after)) return true;
  if (/[|（(]\s*$/.test(before) && /^\s*[|）)]/.test(after)) return true;
  return false;
};
const isPartialNumberOccurrence = (s, idx, term) => {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(term)) return false;
  const before = s[idx - 1] ?? '';
  const after = s.slice(idx + term.length);
  return /[A-Za-z0-9_.]/.test(before)
    || /^(?:\d|\.\d)/.test(after)
    || /^[eE][+-]?\d/.test(after)
    || (!/^[+-]/.test(term) && /[-−]/.test(before));
};

const maskAddresses = (source) => {
  let masked = source
    .replace(/(?:课标要求|教材)[:：][^\n|；;]*/g, (m) => ' '.repeat(m.length))
    .replace(/^\s*MEDIA:\S+/gm, (m) => ' '.repeat(m.length))
    .replace(/(!\[[^\]\n]*\]\()([^\)\n]*)(\))/g, (_, start, url, end) => start + ' '.repeat(url.length) + end);
  if (deliveryManifest?.mode === 'file' && deliveryManifest.path) {
    for (const address of [deliveryManifest.path, pathToFileURL(deliveryManifest.path).href]) {
      masked = masked.split(address).join(' '.repeat(address.length));
    }
  }
  return masked;
};
const balancedMath = (source) => {
  let fence = null;
  const prose = [];
  for (const line of maskAddresses(source).split('\n')) {
    const code = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (code) {
      if (!fence) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
    } else if (!fence) prose.push(line);
  }
  const value = prose.join('\n').replace(/`+[^`]*`+/g, '');
  let delimiter = null;
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '$') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && value[j] === '\\'; j--) slashes++;
    if (slashes % 2) continue;
    const token = value[i + 1] === '$' ? '$$' : '$';
    if (token === '$$') i++;
    if (delimiter === null) delimiter = token;
    else if (delimiter === token) delimiter = null;
    else return false;
  }
  return delimiter === null;
};
const findAnswerLeaks = (terms, source = text) => {
  const leaks = [];
  if (!terms.length) return leaks;
  // 仅遮蔽已验证地址及独立元数据，保留路径外的教学正文和答案。
  const scanText = maskAddresses(source);
  const boundaries = getSolutionBoundaries(source);
  const headings = [...source.matchAll(/^[ \t]*(?:#+[ \t]*)?([〇一二三四五六七])[、.．]/gm)].map((m) => ({ section: m[1], index: m.index }));
  const sectionAt = (index) => {
    if (isAfterFullSolution(index, boundaries)) return '完整解答';
    let current = '?';
    for (const h of headings) {
      if (h.index <= index) current = h.section;
      else break;
    }
    return current;
  };
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    while (from < scanText.length) {
      const idx = scanText.indexOf(term, from);
      if (idx < 0) break;
      const lineStart = source.lastIndexOf('\n', idx) + 1;
      const lineEnd = source.indexOf('\n', idx);
      const lineText = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
      if (isPartialNumberOccurrence(scanText, idx, term) || isStructuralIdOccurrence(scanText, idx, term)) { from = idx + term.length; continue; }
      const line = source.slice(0, idx).split(/\n/).length;
      const section = sectionAt(idx);
      if (section !== '完整解答') leaks.push({ term, line, section, context: lineText.trim().slice(0, 120) });
      from = idx + term.length;
    }
  }
  return leaks;
};

if (presentationText !== null) {
  const isFullDump = ['〇', '一', '二', '三', '四', '五', '六', '七']
    .every((m) => new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?${m}[、.]`).test(presentationText));
  add('学生展示保留核心导航', /速览/.test(presentationText) && /条件/.test(presentationText)
    && /路径/.test(presentationText) && /迁移|审题收获/.test(presentationText) && !isFullDump,
    '学生页需要速览、核心条件、路径和迁移，不能再粘贴完整八模块');
  add('学生页公式定界完整', balancedMath(presentationText), '数学块必须整体保留，不能截断 $ 或 $$ 定界符');
  const leaks = findAnswerLeaks(answerTerms, presentationText);
  add('学生展示答案隔离', leaks.length === 0, leaks.length ? `学生页出现 ${leaks.length} 处答案指纹` : '未发现答案指纹');
  if (deliveryManifest?.status !== 'unavailable' && deliveryManifest) {
    add('学生页引用实际图', hasDeliveryReference(presentationText), '学生页未引用清单中的真实图');
  }
  if (deliveryManifest?.status === 'unavailable') warn.push('WARN 图不可用，学生页仅文字降级，未宣称已交付');
}

// 自适应训练只检查当前回复；完整审计仍单独走八模块闸门。
if (mode === 'training' && trainingState) {
  const phase = trainingState.phase;
  if (requireMedia) add('当前轮次强制图片', phase === 'reveal' && hasDeliveryReference(text), '只有 reveal 阶段且实际图片被引用才能通过强制图片检查');
  const attachments = /MEDIA:|!\[|\[[^\]]*\]\([^\n)]*(?:\.(?:png|jpe?g|webp)|audit\.md)[^\n)]*\)|\baudit\.md\b/i.test(text)
    || (deliveryManifest && hasDeliveryReference(text));
  const revealContent = /隐含条件表|路径提示|收敛[·\s]*路径|(?:^|\n)\s*\|?\s*H\d+\s*(?:\||[:：])/.test(text);
  if (phase !== 'reveal') {
    add('当前阶段不提前揭示或附审计', !attachments && !revealContent,
      '仅 reveal 阶段允许隐含条件、完整路径、图和审计附件');
  } else {
    add('揭示包含具体隐含条件', /H\d+/.test(text), '揭示回复需要 H 编号');
    if (deliveryManifest && deliveryManifest.status !== 'unavailable') {
      add('揭示引用实际图文件', hasDeliveryReference(text), '正文未引用交付清单中的真实图');
    }
  }
  const hintLines = text.split('\n').filter((line) => /^\s*>/.test(line));
  if (phase === 'hint' || phase === 'attempt') {
    const questionMarks = (hintLines.join('').match(/[？?]/g) || []).length;
    add('每轮最多一条提示', hintLines.length <= 1 && questionMarks <= 1,
      '当前回复不能给多行或多个问题的触发词提示');
    if (phase === 'hint') add('提示阶段有一条提示', hintLines.length === 1, '提示阶段需一行 > 提示');
  }
  if (phase === 'transfer') {
    add('迁移检查不提供提示', hintLines.length === 0 && !/提示[:：]|本轮只给|请再想一轮/.test(text), '迁移题使用普通文本，不提供引用提示或触发词提示');
  }
  if (phase === 'complete') add('掌握经过无提示迁移', trainingState.transfer_passed === true, '不能把揭示后看懂视为掌握');
  const leaks = findAnswerLeaks(answerTerms);
  add('训练模式不泄答案', leaks.length === 0, leaks.length ? `发现 ${leaks.length} 处答案指纹` : '未发现答案指纹');
  if (!answerTerms.length) warn.push('WARN 未提供答案指纹，语义与答案隔离仍待人工复核');
  if (deliveryManifest?.status === 'unavailable') warn.push('WARN 图不可用，只能文字降级，未宣称图片已交付');
  const result = { file, mode, protocol: 'adaptive', phase, answerTerms, answerLeaks: leaks, fail, warn, ok,
    structurePass: fail.length === 0, semanticReview: semanticReviewed ? 'done' : 'pending', pass: fail.length === 0 };
  if (jsonMode) console.log(JSON.stringify(result, null, 2));
  else console.log([...ok, ...warn, ...fail].join('\n'));
  process.exit(result.pass ? 0 : 1);
}

// 旧四步汇总记录继续兼容，不要求每次回复含四步。
if (mode === 'training') {
  const stepPos = (n) => {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?(?:\\*\\*)?\\s*第\\s*${n}\\s*步`));
    return m ? m.index : -1;
  };
  const positions = [1, 2, 3, 4].map(stepPos);
  const [p1, p2, p3, p4] = positions;
  const missingSteps = positions.map((p, i) => (p < 0 ? i + 1 : null)).filter(Boolean);
  add('训练四步齐全', missingSteps.length === 0,
    missingSteps.length ? `缺少第 ${missingSteps.join('、')} 步` : '第1–4步齐全');
  add('训练四步顺序', p1 >= 0 && p2 > p1 && p3 > p2 && p4 > p3,
    '四步必须按第1→2→3→4顺序出现');

  const beforeStep3 = p3 >= 0 ? text.slice(0, p3) : text;
  const preMedia = [...beforeStep3.matchAll(/^MEDIA:\S+/gm)].length
    + [...beforeStep3.matchAll(/!\[[^\]]*\]\([^)]*\.(?:png|jpe?g|webp)\)/gi)].length
    + (deliveryManifest && hasDeliveryReference(beforeStep3) ? 1 : 0);
  add('第1/2步不出图', preMedia === 0,
    `第3步前出现 ${preMedia} 处图片交付/引用；训练模式只在第3步揭示后出图`);

  const step2 = p2 >= 0 && p3 > p2 ? text.slice(p2, p3) : '';
  const rounds = [...step2.matchAll(/本轮只给\s*1\s*条触发词提示/g)].length;
  add('第2步提示轮次', rounds >= 1 && rounds <= 2,
    `发现 ${rounds} 轮提示；应为 1–2 轮`);
  const roundBlocks = step2.split(/本轮只给\s*1\s*条触发词提示/).slice(1);
  const badRounds = [];
  roundBlocks.forEach((block, i) => {
    const stop = block.search(/(?:^|\n)\s*(?:---|第\s*3\s*步)/);
    const body = stop >= 0 ? block.slice(0, stop) : block;
    const hintLines = body.split('\n').filter((l) => /^\s*>/.test(l));
    const reThink = body.split('\n').filter((l) => /请再想一轮|请再试一轮/.test(l)).join(' ');
    const hintQs = (hintLines.join('').match(/？/g) || []).length;
    const quotedInReThink = [...reThink.matchAll(/[“"][^”"]{1,24}[”"]/g)].length;
    const secondAsk = /并(?:说明|解释|写出|处理|判断|指出)[^。；\n]{0,12}(?:[“"]|[A-Z]\d+)/.test(reThink);
    if (hintLines.length !== 1 || hintQs > 1 || quotedInReThink > 0 || secondAsk) {
      badRounds.push(`第${i + 1}轮（提示行 ${hintLines.length}、问号 ${hintQs}、追问引用 ${quotedInReThink}${secondAsk ? '、二次点名' : ''}）`);
    }
  });
  add('第2步每轮只1条提示', badRounds.length === 0,
    badRounds.length
      ? `${badRounds.join('；')}；每轮只保留 1 个触发词提示，追问不得再点名第二个条件`
      : '每轮 1 个触发词提示，追问未点名第二个条件');

  const step3 = p3 >= 0 ? text.slice(p3, p4 > p3 ? p4 : text.length) : '';
  add('第3步揭示隐含条件', /H\d+/.test(step3), '第3步未发现 H 编号隐含条件');
  add('第3步出图', hasDeliveryReference(step3),
    '第3步未发现匹配的图片引用；非 MEDIA 模式需要有效交付清单');

  const step4 = p4 >= 0 ? text.slice(p4) : '';
  const ledgerOk = /盲区账本/.test(step4) && /条件类型/.test(step4) && /累计次数/.test(step4);
  add('第4步盲区账本', ledgerOk, '第4步缺少盲区账本表（需含“条件类型/累计次数”列）');
  const ledgerRows = step4.split('\n').filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  add('盲区账本有记录', ledgerRows.length >= 1, '盲区账本没有数据行');

  const leaks = findAnswerLeaks(answerTerms);
  if (!answerTerms.length) {
    warn.push('WARN 未提供 --answer 答案指纹：训练模式的答案隔离检查是空跑，请补上本题最终答案/结论值');
  }
  add('训练模式不泄答案', leaks.length === 0,
    leaks.length ? `答案指纹出现 ${leaks.length} 处：第 ${leaks[0].line} 行 ${leaks[0].context}` : '未发现答案指纹');

  const structurePass = fail.length === 0;
  const result = {
    file,
    mode,
    type,
    answerTerms,
    answerLeaks: leaks,
    fail,
    warn,
    ok,
    structurePass,
    semanticReview: semanticReviewed ? 'done' : 'pending',
    pass: structurePass,
  };
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`文件：${file}\n模式：训练模式\n`);
    console.log([...ok, ...warn, ...fail].join('\n'));
    console.log(`\n结果：结构 ${structurePass ? 'PASS' : 'FAIL'}（${fail.length} 项失败，${warn.length} 项警告）`);
    console.log(`语义：${semanticReviewed ? '已声明人工复核（done）' : '待人工复核（pending）——自动闸门只证明流程顺序、出图时机与提示梯度，不证明点评内容正确'}`);
  }
  process.exit(fail.length ? 1 : 0);
}

// 1. 八模块骨架
const modules = ['〇', '一', '二', '三', '四', '五', '六', '七'];
const missing = modules.filter((m) => !new RegExp(`(^|\\n)\\s*(?:#+\\s*)?${m}[、.]`).test(text));
add('八模块完整', missing.length === 0, missing.length ? `缺少 ${missing.join('、')}` : '〇至七齐全');

// 2. 条件编号与教材列
add('显性条件 C 编号', has(/C\d+/), '未发现 C 编号');
add('隐含条件 H 编号', has(/H\d+/), '未发现 H 编号');
add('H 来源引用', /来源|由\s*C\d+|由C\d+/.test(text), '未发现“来源/由 C 触发”');
add('考纲与教材列', has(/考纲与教材对应|课标要求/), '未发现“考纲与教材对应/课标要求”');
add('教材章节', has(/必修|选择性必修|教材/), '未发现教材册次/章节');
add('触发词', has(/触发词/), '未发现触发词');
// H 表允许“本题没有命中专项隐含条件（不硬造）”——这是诚实输出，不是缺相关度标注。
add('相关度标注', /本题没有命中专项隐含条件/.test(text) || has(/核心|备用|干扰/), '未发现核心/备用/干扰相关度');
add('收敛路径', has(/路径提示|收敛/), '未发现路径提示/收敛模块内容');

// 2.1 结构真相：C 表只能放条件，不能放设问（全库实测 510 行→0 的规则）
const sectionOf = (startRe, endRe) => {
  const a = text.search(startRe);
  if (a < 0) return '';
  const rest = text.slice(a);
  const b = rest.search(endRe);
  return b > 0 ? rest.slice(0, b) : rest;
};
const cSection = sectionOf(/##\s*二、/, /##\s*三、/);
if (cSection) {
  const cRows = cSection.split('\n').filter((l) => /^\|\s*C\d+/.test(l));
  const badC = cRows.filter((l) => /_{2,}|＿{2,}|【空】|\\quad|[（(]\s*[）)]/.test(l));
  add('C 表不含设问空位', badC.length === 0, `${badC.length} 行 C 把设问/空位当条件；应只保留空位前的条件分句`);
}
// 2.1b 目标分析必须能直接指导学生“先看哪一类条件”，不能只是把小问原文截断后塞进表格。
const targetSection = sectionOf(/##\s*一、/, /##\s*二、/);
if (targetSection) {
  const targetHeader = (targetSection.match(/^\|\s*小问\s*\|.*$/m) || [])[0] || '';
  const qRows = targetSection.split('\n').filter((l) => /^\|\s*Q\d+\s*\|/.test(l));
  const expectsMulti = qCount === null ? qRows.length >= 2 : qCount > 1;
  if (expectsMulti) {
    add('目标分析两列', /问什么/.test(targetHeader) && /从哪类条件入手/.test(targetHeader),
      '多问题目应使用“| 小问 | 问什么 | 从哪类条件入手 |”三列表；不能退回一段长文字或只写“求什么”');
    const badTargets = qRows.filter((l) => {
      const cells = l.split('|').map((x) => x.trim());
      const ask = cells[2] || '';
      const basis = cells[3] || '';
      const askTooLong = ask.length > 90;
      const askTruncated = /(?:…|\.\.\.)\s*$/.test(ask) || /^(?:见|略|同上|原题)/.test(ask);
      const askTooThin = ask.replace(/[\s，,。；;]/g, '').length < 5;
      const basisHasAnchor = /C\d+|G\d+|H\d+/.test(basis);
      const basisFallback = /题干(?:总体)?条件|本问动词|条件类别/.test(basis);
      return askTooLong || askTruncated || askTooThin || (!basisHasAnchor && !basisFallback);
    });
    add('目标分析可执行', badTargets.length === 0,
      `${badTargets.length} 行目标分析仍是截断原文或只写知识点名；应写成“任务骨架 + 由 C/G/H 哪类条件切入”`);
  }
  const targetRowCount = qRows.length;
  if (qCount !== null && qCount > 1 && targetRowCount < qCount) {
    add('目标分析覆盖小问', false, `应有 Q1–Q${qCount} 共 ${qCount} 行，实际 ${targetRowCount} 行`);
  }
}

// 2.2 B 表每行要有“【空】”或“（作答点）”，否则学生不知道这行依据对应哪一空
const bSection = sectionOf(/##\s*六、/, /##\s*七、/);
if (bSection) {
  const bRows = bSection.split('\n').filter((l) => /^\|\s*B\d+/.test(l));
  const badB = bRows.filter((l) => !/【空】|（作答点）|\(作答点\)/.test(l));
  add('B 表保留空位/作答点标记', badB.length === 0, `${badB.length} 行 B 缺少【空】/（作答点）标记`);
}
// 2.3 30 秒速览不能输出被截断的公式
const askLine = (text.match(/1\.\s*这题在问：(.*)/) || [])[1] || '';
add('30 秒速览公式闭合', (askLine.match(/\$/g) || []).length % 2 === 0, '速览里的 $ 未成对，公式被截断');
// 2.4 选择题的“问什么”必须具体到对象，不能只剩“则/该函数/所给说法/正确的一项”。
const genericAsk = /^选出：\s*(?:则|该函数|此过程|该系统|该物质|该反应|正确的?|不正确的?|合理的?|不合理的?)(?:有)?\s*（/.test(askLine)
  || /所给(?:说法|叙述|描述|判断|结论|分析)/.test(askLine)
  || /符合题干条件的一项/.test(askLine);
add('30 秒速览设问具体', !genericAsk, '速览只写了判断词或“所给说法”，没有问对象');
// 2.5 选择题 H1 不能停在“逐项验证”这种通用兜底；H1 应是本题最具体的触发规则。
const hSection = sectionOf(/##\s*三、/, /##\s*四、/);
const h1Row = (hSection.split('\n').find((l) => /^\|\s*H1\s*\|/.test(l)) || '');
if (type === 'choice' || /选择题|单选题|多选题/.test((text.match(/题型：([^\n]+)/) || [])[1] || '')) {
  add('选择题 H1 具体', !!h1Row && !/逐项验证/.test(h1Row), 'H1 仍是“逐项验证”通用兜底，应换成题干/选项级具体规则');
}
// 2.6 四个选项的验证角度必须按选项内容区分；只允许“本项核对”之外完全相同。
const qSection = sectionOf(/##\s*四、/, /##\s*五、/);
const optionRows = qSection.split('\n').filter((l) => /^\|\s*选项\s*[A-D]\s*\|/.test(l));
if (optionRows.length >= 2) {
  const angleOf = (l) => (l.split('|')[3] || '').trim();
  const angles = optionRows.map(angleOf);
  const allSame = angles.every((a) => a === angles[0]);
  add('选项验证角度有区分', !allSame, '各选项验证角度完全相同，未落到本选项的关键内容');
}

// 3. 题型专项
if (type === 'fill' || type === 'mixed') {
  add('填空 B 编号', has(/B\d+/), '未发现 B 编号；填空题必须逐空编号');
  add('填空待填类型', has(/待填类型|数值\/|方向\/|名称\/|化学式\//), '未发现待填类型说明');
}
if (answerSlots !== null && Number.isFinite(answerSlots)) {
  const bIds = new Set([...text.matchAll(/\bB(\d+)\b/g)].map((m) => m[1]));
  const numeric = [...bIds].map(Number).sort((a, b) => a - b);
  const missingIds = firstMissingNumbers(answerSlots, numeric);
  add(
    '一空一 B',
    bIds.size >= answerSlots,
    `应作答 ${answerSlots} 处（显式空 ${blanks ?? '?'}），输出只有 ${bIds.size} 个 B 号${bIds.size < answerSlots ? '；有合并/漏答' : ''}`,
    'fail',
  );
  add(
    'B 号连续',
    missingIds.length === 0,
    `缺少 ${missingIds.map((n) => `B${n}`).join('、') || '无'}；应覆盖 B1–B${answerSlots}`,
    'fail',
  );
  if (bIds.size > answerSlots) {
    warn.push(`WARN B 号多于应作答数：应作答 ${answerSlots} 处，输出出现 ${bIds.size} 个 B 号；请确认没有把其他题/其他小问的 B 号混入`);
  }
  if (answerSlots >= 2 && !/空号|B\d+\s*[（(]\s*Q\d+|B\s*号.*小问|空白清单/.test(text)) {
    warn.push('WARN 多空题未附“空号—小问—待填类型”映射表；建议补上，便于逐空作答与批改');
  }
  if (answerSlots >= 2 && requireBlankMap && !/待填类型/.test(text)) {
    add('空白作答卡', false, '多空题缺少“空号—小问—待填类型”映射表（--require-blank-map）');
  } else if (answerSlots >= 2 && /待填类型/.test(text)) {
    ok.push('PASS 空白作答卡含待填类型');
  }
}
if (qCount !== null && Number.isFinite(qCount) && qCount > 0) {
  if (qCount === 1) {
    // 单问题目不强制 Q1 编号；仅当出现 Q2+ 却没有 Q1 时才提示编号断裂。
    if (/\bQ2\b/.test(text) && !/\bQ1\b/.test(text)) {
      add('小问 Q 编号连续', false, '出现 Q2 却缺少 Q1');
    } else {
      ok.push('PASS 单问（无需 Q 编号或 Q1 已标注）');
    }
  } else {
    const presentQ = [...text.matchAll(/\bQ(\d+)\b/g)].map((m) => Number(m[1]));
    const missingQ = firstMissingNumbers(qCount, presentQ).map((n) => `Q${n}`);
    add('小问 Q 编号连续', missingQ.length === 0, missingQ.length ? `缺少 ${missingQ.join('、')}` : `Q1–Q${qCount} 齐全`);
  }
}
if (type === 'choice' || type === 'mixed') {
  // 只认“A.”“A、”“A项”“选项A”这类真正的选项标记；不把“A 酸”“A 组”“B 细胞”当选项。
  // 跳过 MEDIA/图片行（文件名里的 "MEDIA:" 会被误当成 "A:"）；选项标记必须在行首或紧跟“选项”。
  const scanText = text.split('\n').filter((l) => !/^\s*MEDIA:/.test(l) && !/!\[/.test(l)).join('\n');
  const optionRe = /(?:^|\n)\s*([A-D])\s*[.．、:：)）]|选项\s*([A-D])|([A-D])\s*项/g;
  const letters = new Set([...scanText.matchAll(optionRe)].map((m) => m[1] || m[2] || m[3]));
  const level = type === 'choice' ? 'fail' : 'warn';
  const looksLikeChoice = letters.size >= 2 || /选项\s*[A-D]/.test(text);
  if (type === 'choice' || looksLikeChoice) {
    add('选项 A-D 覆盖', letters.size === 4, `发现 ${[...letters].sort().join('/') || '无'}`, level);
    add('逐项验证点', /逐项|各项|选项\s*A|A\s*项/.test(text), '未发现选项逐项分析', level);
  }
}
if (type === 'experiment') {
  const expWords = ['自变量', '因变量', '控制变量', '对照', '等量', '重复', '误差'];
  const found = expWords.filter((w) => text.includes(w));
  add('实验九项要素', found.length >= 6, `命中 ${found.join('、') || '无'}；至少需 6 项`, type === 'mixed' ? 'warn' : 'fail');
}
if (type === 'calculation' || type === 'solution' || type === 'mixed') {
  // μmol·mol⁻¹ 是浓度单位，不是化学专用符号；先遮蔽，避免生物题被误判为化学题。
  const unitText = text.replace(/[μµ]mol(?:\s*·\s*mol[⁻−]?[¹1])?/g, ' ');
  const physical = /(速度|加速度|受力|重力|摩擦力|拉力|推力|合力|外力|电压|电流|电阻|功率|质量(?:为|是|m\b)|电场|磁场|\bmol\b)/.test(unitText);
  if (type === 'calculation' || physical) {
    const isChem = /\bmol\b|浓度|溶液|离子|化学式|化学方程式/.test(unitText);
    add('单位/量纲检查', has(/单位/) && (isChem || has(/量纲|量纲检查|数量级/)), '未同时发现“单位”和“量纲/数量级”', type === 'calculation' ? 'fail' : 'warn');
  }
  if (type !== 'solution' || /(小问|（1）|Q1)/.test(text)) {
    add('多问 Q 编号', has(/Q\d+/), '未发现 Q 编号；多问题目应分问', 'warn');
  }
}

// 4. 图形与媒体
const mediaLines = [...text.matchAll(/^MEDIA:(\S+)/gm)];
if (requireMedia) {
  add(delivery === 'media' ? 'MEDIA 图片交付' : '图片文件引用',
    deliveryManifest ? hasDeliveryReference(presentationText ?? text) : mediaLines.length >= 1,
    '未发现与交付模式匹配的真实图引用');
  const nonAbs = mediaLines.filter((m) => !m[1].startsWith('/'));
  if (nonAbs.length) warn.push(`WARN MEDIA 路径不是绝对路径：${nonAbs[0][1]}`);
}
if (/(如图|图\s*\d|图[12]|表格|装置图|电路图)/.test(text)) {
  add('图形 G 编号', has(/G\d+|G0/), '提到图/表/装置但未发现 G 编号', 'warn');
}

// 5. 高风险泄题词。解题模式只允许在“完整解答”标题之后出现答案。
const risky = [];
const lines = text.split(/\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const index = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
  if (isAfterFullSolution(index)) continue;
  if (/(正确答案|故选|答案是|答案为|应选(?=\s*[A-DＡ-Ｄ])|正确选项是|排除\s*[A-D]|因此选)/.test(line)) risky.push(`第 ${i + 1} 行：${line.trim().slice(0, 90)}`);
}
if (solutionMode && fullSolutionAt < 0 && answerTerms.length) {
  warn.push('WARN 使用 --solution，但未找到“完整解答/完整解析/解题过程/解答”标题；无法区分八模块讲解区与解答区');
}
if (risky.length) {
  warn.push(`WARN 可能泄题：发现 ${risky.length} 处高风险词，请确认不在讲解模式正文中\n  ${risky.slice(0, 5).join('\n  ')}`);
} else {
  ok.push('PASS 未发现明显选项/答案泄漏词');
}
if (/(符合|不符合)/.test(text) && !solutionMode) {
  const choiceCtx = /选项|A\s*项|B\s*项|C\s*项|D\s*项/.test(text);
  // 选项原文本身可能含“符合/不符合”（如“下列符合……的是”），引用选项不算泄题。
  // 只对“判定句”报警：排除以“选项 A/| 选项 A/ A. ”开头的引文行。
  const judgeLines = lines.filter((line) => {
    if (!/(符合|不符合)/.test(line)) return false;
    // Markdown 表格行是“条件/选项原文”的引用，不是判定句；整行跳过。
    if (/^\s*\|/.test(line)) return false;
    if (/^\s*>/.test(line)) return false;
    // 大爆炸文字树/条件摘录也是原文引用。
    if (/^\s*[├└│]/.test(line)) return false;
    if (/\bC\d+\b/.test(line) && /已知|条件|原文|关系符合/.test(line)) return false;
    if (/^\s*(\|\s*)?选项\s*[A-D]\b/.test(line)) return false;
    if (/^\s*[A-D]\s*[.．、:：]/.test(line)) return false;
    // 只有“选项判定”特征才报警：A 项符合 / 符合题意 / 因此符合。
    // 仅出现“符合”二字（条件原文、设问原文）不算泄题。
    return /[A-D]\s*项\s*(符合|不符合)|(符合|不符合)\s*题意|(因此|所以|故)\s*(符合|不符合)/.test(line);
  });
  if (choiceCtx && judgeLines.length) warn.push(`WARN 讲解模式出现“符合/不符合”：逐项判定可能变相泄题，应改为“触发什么知识点/验证什么”（${judgeLines.length} 行）`);
}

// 5.1 答案指纹反查：八模块都检查，只豁免独立完整解答区。
const answerLeaks = findAnswerLeaks(answerTerms);
if (answerTerms.length) {
  if (answerLeaks.length) {
    const msg =
      `答案指纹出现在正文：${answerLeaks.length} 处，请确认是否泄题（审题收获也不能写最终答案；课标行仍需人工判断）\n  ` +
        answerLeaks.slice(0, 8).map((x) => `第 ${x.line} 行（${x.section}）：${x.context}`).join('\n  ');
    if (strictAnswer) add('答案指纹隔离', false, msg); else warn.push(`WARN ${msg}`);
  } else {
    ok.push('PASS 答案指纹未出现在八模块正文');
  }
}

// 6. 图形缺失停靠
if (/(图|表|装置|公式)/.test(text) && /待核实|缺失项|G0/.test(text)) ok.push('PASS 已使用待核实/G0 停靠');

// 7. 选择题必须给出选项级审题：H 表不能只有“未命中”占位，逐项角度不能全是同一句兜底。
if (type === 'choice') {
  const hRows = [...text.matchAll(/^\|\s*H\d+\s*\|.*$/gm)].map((m) => m[0]);
  const onlyPlaceholder = hRows.length === 0
    || (hRows.length === 1 && /本题没有命中专项隐含条件/.test(hRows[0]));
  add('选择题选项级隐含条件', !onlyPlaceholder,
    '选择题 H 表只有“未命中”占位；应至少给出一条选项级验证策略（单位/守恒/端点/绝对化/图像等）');

  const angleRows = [...text.matchAll(/^\|\s*选项\s*[A-H]\s*\|[^|]*\|([^|]*)\|/gm)].map((m) => m[1].trim());
  const badAngles = angleRows.filter((a) => a === '核对概念/单位/因果是否与题干一致');
  if (angleRows.length >= 2) {
    add('选项验证角度具体化', badAngles.length === 0,
      `有 ${badAngles.length} 个选项仍用通用兜底角度；应按选项内容给具体角度（单位/守恒/端点/绝对化等）`);
  }
}

const structurePass = fail.length === 0;
const result = {
  file,
  type,
  blanks,
  answerSlots,
  qCount,
  answerTerms,
  answerLeaks,
  fail,
  warn,
  ok,
  structurePass,
  semanticReview: semanticReviewed ? 'done' : 'pending',
  pass: structurePass,
};
if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`文件：${file}\n题型：${type}\n`);
  console.log([...ok, ...warn, ...fail].join('\n'));
  console.log(`\n结果：结构 ${structurePass ? 'PASS' : 'FAIL'}（${fail.length} 项失败，${warn.length} 项警告）`);
  console.log(`语义：${semanticReviewed ? '已声明人工复核（done）' : '待人工复核（pending）——自动闸门只证明结构、编号与答案隔离，不证明条件解释正确'}`);
}
process.exit(fail.length ? 1 : 0);
