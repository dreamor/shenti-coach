#!/usr/bin/env node
// Complete audit -> gated, compact learner page + separate teacher audit. No rendering/upload.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDelivery } from './lib/delivery.mjs';

const IDS = ['〇', '一', '二', '三', '四', '五', '六', '七'];
const MODULE = /^ {0,3}(?:#{1,6}[ \t]*)?([〇一二三四五六七])[、.．][ \t]*(.*)$/;
const ANSWER = /^ {0,3}(?:#{1,6}[ \t]*)?(?:\*\*)?(完整解答|完整解析|解题过程|解答|官方答案|参考答案|正确答案|标准答案|教师答案|答案)(?:\*\*)?(?:[（(][^\n]*[）)])?(?:[：:].*|[ \t]*)$/;
const PRIVATE = /\b(?:private|confidential|teacher[- ]only)\b|私有|私密|(?:仅供|仅|供)教师|教师(?:专用|私有|备注|附录)|官方答案(?:核对|检查)|内部(?:附录|资料)/i;
const USAGE = '用法: node scripts/present_output.mjs <完整audit.md> <新输出目录> [--mode explain|training] [--phase reveal] [--training-state JSON --student ID --question ID] [--solution] [--strict-answer --answer term ...] [--delivery auto|media|markdown|file] [--capabilities JSON] [--render-result JSON --expected-path PNG绝对路径]';

function context({ mode = 'explain', phase = null, solution = false } = {}) {
  if (!['explain', 'training'].includes(mode)) throw new Error('mode 模式只能是 explain/training');
  if (typeof solution !== 'boolean') throw new Error('solution 必须是显式 boolean');
  if (phase !== null && phase !== 'reveal') throw new Error('本工具只支持 phase=reveal；早期阶段使用状态机当前回复');
  if (mode === 'training' && phase !== 'reveal') throw new Error('训练仅在明确 phase=reveal 阶段可投影完整 audit');
  if (mode === 'training' && solution) throw new Error('训练禁止 --solution 解题模式');
  return { mode, phase, solution };
}

/** Pure structural parse of ONE complete audit. Content metadata cannot choose mode/phase. */
export function parseAudit(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('audit 必须是非空文本 string');
  const ctx = context(options);
  validateMath(source);
  const headings = [];
  const answers = [];
  const sections = [];
  let offset = 0;
  let fence = null;
  let questionTitles = 0;
  for (const raw of source.split(/(?<=\n)/)) {
    const line = raw.replace(/[\r\n]+$/, '');
    const code = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (code) {
      if (!fence) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
    } else if (!fence) {
      const section = line.match(/^ {0,3}(#{1,6})[ \t]*(.*)$/);
      const bareTitle = line.replace(/^\s*\*\*|\*\*\s*$/g, '').trim();
      const answer = line.match(ANSWER) || bareTitle.match(ANSWER)
        || line.match(/^ {0,3}#{1,6}[ \t]+(?:\*\*)?(完整解答|完整解析|解题过程|官方答案|参考答案|正确答案|标准答案|教师答案)/);
      if (((section || answer || /^\s*\*\*.+\*\*\s*$/.test(line)) && PRIVATE.test(bareTitle))
        || /^(?:私有|私密|仅教师|仅供教师|教师附录|官方答案核对|private\b|teacher[- ]only\b)/i.test(bareTitle)) {
        throw new Error('私有/private 或仅教师审计不能交付；请先拆分教师附录，避免 audit 文件旁路泄露');
      }
      if (section) sections.push({ start: offset, depth: section[1].length });
      if (/^ {0,3}(?:#{1,6}[ \t]+)?(?:第\s*\d+\s*题|题目?\s*\d+[：:.、]|Question\s+\d+\b)/i.test(line)) questionTitles++;
      const module = line.match(MODULE);
      if (module) headings.push({ id: module[1], title: module[2].trim(), start: offset, bodyStart: offset + raw.length });
      if (answer) answers.push({ title: answer[1], start: offset, bodyStart: offset + raw.length, depth: section?.[1].length ?? 0 });
    }
    offset += raw.length;
  }
  if (fence) throw new Error('audit 代码围栏未闭合，模块边界不明确');
  if (questionTitles > 1) throw new Error('仅支持明确单题 audit；多题须逐题分文件');
  if (headings.length !== IDS.length || IDS.some(id => headings.filter(h => h.id === id).length !== 1)) {
    throw new Error('需要完整单题八模块 〇至七；缺模块、重复模块或多题数据均拒绝');
  }
  if (headings.some((h, index) => h.id !== IDS[index] || !h.title)) throw new Error('八模块标题/顺序不明确');
  const firstAnswer = answers[0];
  if (firstAnswer && firstAnswer.start < headings[7].bodyStart) throw new Error('完整解答/官方答案只能在八模块之后独立保存');
  const modules = headings.map((heading, index) => {
    const end = headings[index + 1]?.start ?? firstAnswer?.start ?? source.length;
    const body = source.slice(heading.bodyStart, end).trim();
    if (!body) throw new Error(`模块 ${heading.id} 不能为空`);
    return Object.freeze({ id: heading.id, title: heading.title, body });
  });
  const fullSolution = /^(完整解答|完整解析|解题过程|解答)$/;
  const endSection = firstAnswer && sections.find(section => section.start > firstAnswer.start
    && (firstAnswer.depth === 0 || section.depth <= firstAnswer.depth))?.start;
  const nextAnswer = firstAnswer && answers.find(answer => answer.start > firstAnswer.start
    && (!fullSolution.test(answer.title) || answer.depth <= firstAnswer.depth))?.start;
  const solution = firstAnswer && fullSolution.test(firstAnswer.title)
    ? source.slice(firstAnswer.start, Math.min(endSection ?? source.length, nextAnswer ?? source.length)).trim() : '';
  return Object.freeze({ source, ...ctx, modules: Object.freeze(modules), solutionText: solution });
}

function tableRows(body, prefix) {
  let headers = [];
  const rows = [];
  for (const line of body.split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim());
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    if (!new RegExp(`^${prefix}\\d+$`).test(cells[0])) { headers = cells; continue; }
    const rowHeaders = headers;
    const get = re => cells[rowHeaders.findIndex(header => re.test(header))] ?? '';
    rows.push({ id: cells[0], cells, get });
  }
  return rows;
}

function hasHtml(line) {
  const outsideMath = line.replace(/\$\$.*?\$\$|\$[^$\n]*\$/g, '');
  return /<!--|<!doctype\b|<\/?[A-Za-z][\w:-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/i.test(outsideMath);
}

function mathTokens(line) {
  if (/^\s*MEDIA:/.test(line)) return [];
  const text = line.replace(/`+[^`]*`+/g, '').replace(/(\[[^\]\n]*\]\()[^\)\n]*(\))/g, '$1$2');
  const tokens = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] !== '$') { i++; continue; }
    const size = text[i + 1] === '$' ? 2 : 1;
    tokens.push(size);
    i += size;
  }
  return tokens;
}
function validateMath(source) {
  let open = 0;
  let fence = null;
  const invalid = () => { throw new Error('源公式 $/$$ 未闭合或定界符不匹配；拒绝投影'); };
  for (const line of source.split('\n')) {
    const code = line.match(/^\s*(`{3,}|~{3,})/);
    if (code) {
      if (!fence) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    if (open && (/^\s*#+/.test(line) || MODULE.test(line))) invalid();
    for (const token of mathTokens(line)) {
      if (!open) open = token;
      else if (open === token) open = 0;
      else invalid();
    }
    if (open === 1) invalid(); // Inline formulas must close on their own line.
  }
  if (open) invalid();
}

// Budget whole logical units; a multi-line $$ block is indivisible, never a prefix.
function prose(body, maxUnits = 4) {
  const out = [];
  let fence = false;
  let block = [];
  for (const raw of body.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const line = raw.trim();
    const boundary = mathTokens(line).filter(token => token === 2).length % 2;
    if (block.length) {
      block.push(line);
      if (boundary) { out.push(block.join('\n')); block = []; }
      continue;
    }
    if (boundary) { block = [line]; continue; }
    if (!line || /^\||^#+|^MEDIA:|!\[|考纲与教材对应|课标要求|教材[:：]/.test(line)) continue;
    if (line.length > 300 || hasHtml(line)) continue;
    out.push(line);
  }
  if (block.length) throw new Error('数学块 $$ 未闭合；拒绝截断投影');
  return out.slice(0, maxUnits);
}

function projectPaths(body, targets) {
  const groups = new Map();
  let shared = [];
  let current = null;
  let fence = false;
  let displayMath = false;
  for (const line of body.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence;
    const marker = !fence && !displayMath && line.match(/^ {0,3}(?:#{1,6}[ \t]*)?(?:\*\*)?(Q\d+)\b(?:\*\*)?(.*)$/);
    if (!fence && mathTokens(line).filter(token => token === 2).length % 2) displayMath = !displayMath;
    if (marker) {
      current = marker[1];
      if (!groups.has(current)) groups.set(current, { label: marker[2].trim(), lines: [] });
    } else (current ? groups.get(current).lines : shared).push(line);
  }
  const ids = [...new Set([...targets.map(row => row.id), ...groups.keys()])];
  if (!groups.size && ids.length === 1) {
    groups.set(ids[0], { label: '', lines: shared });
    shared = [];
  }
  const out = [];
  const common = prose(shared.join('\n'), 3);
  if (common.length) out.push('共同路径：\n' + common.join('\n'));
  for (const id of ids) {
    const target = targets.find(row => row.id === id);
    const group = groups.get(id);
    const title = target?.get(/问什么|求什么/) || group?.label || '本问路径';
    const steps = prose(group?.lines.join('\n') ?? '', 3);
    const navigation = target?.get(/从哪类条件入手|判断依据/) || '本问独立路径待复核，见审计';
    out.push(`### ${id} · ${title}\n${steps.length ? steps.join('\n') : `导航：${navigation}`}`);
  }
  return out.join('\n\n') || '详见独立审计的收敛路径。';
}

/** Pure projection, not a PASS assertion. The CLI runs the real checker before persisting it.
 * Accept source text or parseAudit output; ALWAYS reparse with caller options, never trust pass/mode metadata.
 */
export function buildPresentation(audit, options = {}) {
  const parsed = parseAudit(typeof audit === 'string' ? audit : audit?.source, options);
  const bodies = parsed.modules.map(module => module.body);
  const conditions = tableRows(bodies[2], 'C');
  const hidden = tableRows(bodies[3], 'H').filter(row => row.get(/相关度/).includes('核心')).slice(0, 3);
  const target = tableRows(bodies[1], 'Q');
  const overviewAt = bodies[0].search(/30\s*秒(?:钟)?速览/);
  const overview = overviewAt >= 0
    ? prose(bodies[0].slice(overviewAt).replace(/^30\s*秒(?:钟)?速览\s*[:：]?/, ''), 3)
    : target.slice(0, 3).map(row => `${row.id}：${row.get(/问什么|求什么/)}`);
  const chain = hidden.map(row => {
    const source = row.get(/来源/);
    const ids = [...new Set(source.match(/C\d+/g) ?? [])];
    const originals = ids.map(id => conditions.find(c => c.id === id)).filter(Boolean);
    const explicit = originals.map(c => `${c.id} ${c.get(/条件原文|显性条件/)}`).join('；');
    const trigger = row.get(/触发词/);
    const implicit = row.get(/隐含条件/);
    return `- ${explicit || source || '来源待复核'} → ${row.id} ${implicit}${trigger ? `（触发词：${trigger}）` : ''}`;
  });
  const parts = [
    '# 学生审题页',
    '## 30 秒速览\n' + (overview.join('\n') || '目标见审计一模块；先核对本题设问与题面完整性。'),
    '## 核心条件 · C/H 链\n' + (chain.join('\n') || '本题未列明确的核心 H，不硬造；详见独立审计。'),
    '## 路径\n' + projectPaths(bodies[5], target),
    '## 陷阱与迁移\n' + [...prose(bodies[6], 2).map(line => `陷阱：${line}`), ...prose(bodies[7], 1).map(line => `迁移：${line}`)].join('\n'),
  ];
  if (parsed.solution && parsed.solutionText) parts.push(parsed.solutionText);
  const learner = parts.join('\n\n')
    .replace(/^\s*MEDIA:[^\n]*$/gm, '')
    .replace(/!\[[^\]\n]*\](?:\([^\n]*?\)|\[[^\]\n]*\])/g, '[图片未验证，见本地交付]')
    .replace(/<img\b[^>]*>/gi, '[图片未验证，见本地交付]');
  return { mode: parsed.mode, phase: parsed.phase, learner: learner + '\n', audit: parsed.source };
}

function parseArgs(argv) {
  if (argv.length < 2 || argv[0].startsWith('--') || argv[1].startsWith('--')) throw new Error(USAGE);
  const opts = { source: argv[0], output: argv[1], mode: 'explain', phase: null, solution: false, requested: 'auto', checkerArgs: [] };
  const values = new Map([
    ['--mode', 'mode'], ['--phase', 'phase'], ['--delivery', 'requested'], ['--capabilities', 'capabilitiesFile'],
    ['--render-result', 'renderFile'], ['--expected-path', 'expectedPath'], ['--training-state', 'stateFile'],
    ['--student', 'student'], ['--question', 'question'],
  ]);
  const checkerValues = new Set(['--answer', '--type', '--blanks', '--answer-slots', '--q-count']);
  const checkerFlags = new Set(['--strict-answer', '--require-blank-map', '--semantic-reviewed', '--strict-semantic']);
  const seen = new Set();
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag) && flag !== '--answer') throw new Error(`重复参数：${flag}`);
    seen.add(flag);
    if (values.has(flag) || checkerValues.has(flag)) {
      const value = argv[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`参数 ${flag} 缺少有效值`);
      if (values.has(flag)) opts[values.get(flag)] = value;
      else opts.checkerArgs.push(flag, value);
    } else if (flag === '--solution') opts.solution = true;
    else if (checkerFlags.has(flag)) opts.checkerArgs.push(flag);
    else throw new Error(`未知参数：${flag}\n${USAGE}`);
  }
  context(opts);
  return opts;
}

function readJson(file) {
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('交付 JSON 读取或解析失败；未完成学生交付'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('交付 JSON 必须是对象');
  return value;
}

async function trainingGate(opts) {
  if (opts.mode !== 'training') return;
  if (!opts.stateFile || !opts.student || !opts.question) throw new Error('training reveal 必须提供 --training-state/--student/--question 绑定真实状态');
  const { validateTraining } = await import('./training_state.mjs');
  const state = readJson(opts.stateFile);
  validateTraining(state);
  if (state.phase !== 'reveal' || state.student_id !== opts.student || state.question_id !== opts.question) {
    throw new Error('训练状态必须为 reveal 且 student/question 与可信 CLI 上下文一致');
  }
}

function runGate(file, args) {
  const checked = spawnSync(process.execPath, [fileURLToPath(new URL('./check_output.mjs', import.meta.url)), file, '--mode', 'explain', '--json', ...args],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(checked.stdout); } catch { /* Fail closed, including checker startup errors. */ }
  if (checked.error || checked.status !== 0 || report?.pass !== true || report.structurePass !== true || !Array.isArray(report.fail) || report.fail.length) {
    const stage = args.includes('--presentation') ? '学生页' : '审计';
    const status = Number.isInteger(checked.status) ? checked.status : 'unavailable';
    throw new Error(`${stage}校验失败（check_output 状态：${status}）；未完成学生交付`);
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  let outputCreated = false;
  let output;
  try {
    const opts = parseArgs(argv);
    await trainingGate(opts); // Refuse all early training access before reading teacher audit.
    const sourcePath = realpathSync(path.resolve(opts.source));
    output = path.resolve(opts.output);
    let targetExists = false;
    try { lstatSync(output); targetExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (targetExists || output === sourcePath || sourcePath.startsWith(output + path.sep)) throw new Error('新输出目录已存在或与 source 冲突；拒绝覆盖');
    const source = readFileSync(sourcePath, 'utf8');
    // A reveal audit is eight modules, NOT the state machine's current-turn training reply.
    const checkerArgs = [...(opts.solution ? ['--solution'] : []), ...opts.checkerArgs];
    const report = runGate(sourcePath, checkerArgs);
    if (readFileSync(sourcePath, 'utf8') !== source) throw new Error('校验期间 source 已变化，请重试；拒绝未校验投影');
    const projected = buildPresentation(source, opts);
    const delivery = resolveDelivery({ requested: opts.requested,
      capabilities: opts.capabilitiesFile ? readJson(opts.capabilitiesFile) : {},
      renderResult: opts.renderFile ? readJson(opts.renderFile) : null,
      expectedPath: opts.expectedPath ? path.resolve(opts.expectedPath) : null,
    });
    if (delivery.path && /[\x00-\x1f\x7f]/.test(delivery.path)) throw new Error('交付路径不能包含控制字符');
    const codeFence = '`'.repeat(Math.max(0, ...(delivery.path?.match(/`+/g) ?? []).map((part) => part.length)) + 1);
    const note = delivery.status === 'reference-ready'
      ? `${delivery.reference}\n\n仅准备本地引用，未上传、未附加，客户端能否显示需实际确认。`
      : delivery.status === 'local-only'
        ? `本地 PNG 文件：${codeFence}${delivery.path}${codeFence}\n\n未送达：仅给本地文件路径，未上传、未附加。`
        : '图片 unavailable：没有通过渲染结果与真实 PNG 校验的可用引用；本次仅本地文字交付，未送达、未上传。';
    mkdirSync(path.dirname(output), { recursive: true });
    mkdirSync(output); // No recursive mkdir on target: existing directories/symlinks must fail.
    outputCreated = true;
    writeFileSync(path.join(output, 'learner.md'), projected.learner + '\n## 本地交付\n' + note + '\n\n完整八模块保存在独立 audit.md（教师审计，不重复贴学生正文）。\n', { flag: 'wx' });
    writeFileSync(path.join(output, 'audit.md'), projected.audit, { flag: 'wx' });
    writeFileSync(path.join(output, 'delivery.json'), JSON.stringify(delivery, null, 2) + '\n', { flag: 'wx' });
    runGate(path.join(output, 'audit.md'), [...checkerArgs, '--presentation', path.join(output, 'learner.md'),
      '--delivery', delivery.mode, '--delivery-manifest', path.join(output, 'delivery.json')]);
    console.log(JSON.stringify({ ok: true, mode: opts.mode, phase: opts.phase, output, delivery, semanticReview: report.semanticReview,
      note: '仅保存本地文件与引用，未上传或附加；结构通过不等于语义通过。' }, null, 2));
    return 0;
  } catch (error) {
    if (outputCreated) rmSync(output, { recursive: true, force: true });
    console.error(error.message);
    return 2;
  }
}

// Importing the pure functions never parses process.argv, writes files or exits the host.
// Compare realpaths: argv keeps a symlinked invoked path (macOS /tmp -> /private/tmp,
// installed skill dirs behind links) while the loader resolves this module fully.
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (invokedAsMain()) {
  process.exitCode = await main();
}
