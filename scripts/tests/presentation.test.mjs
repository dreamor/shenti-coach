import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { parseAudit, buildPresentation } from '../present_output.mjs';
import { resolveDelivery, validateDeliveryManifest } from '../lib/delivery.mjs';
import { createTraining, reduceTraining } from '../training_state.mjs';
import { createTempDir, repoRoot, runScript } from './helpers.mjs';

const audit = `## 〇、题目复述与题型识别
数学，题型：解答题。
30 秒速览：
①这题在问什么：求函数的定义域。
②最关键的触发词：lg。
③最容易踩的坑：忽略真数约束。

## 一、目标分析
| 小问 | 问什么 | 从哪类条件入手 |
| --- | --- | --- |
| Q1 | 求函数的定义域区间 | 由 C1 与 H1 入手 |

## 二、显性条件表
| 编号 | 来源 | 条件原文 | 类型 | 触发词 | 对应知识点 | 考纲与教材对应 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 题干 | 已知函数 f(x)=lg(x) | 关系 | lg | 对数函数 | 课标要求：理解定义域；教材：必修第四章；冗长教材映射不重复 |

| 空号 | 小问 | 待填类型 | 判断依据 |
| --- | --- | --- | --- |
| B1 | Q1 | 区间 | 由 C1 与 H1 判断 |

## 三、隐含条件表
| 编号 | 隐含条件 | 来源 | 触发词 | 相关度 | 考纲与教材对应 |
| --- | --- | --- | --- | --- | --- |
| H1 | 真数满足定义条件 | 由 C1 触发 | lg | 核心 | 必修对数函数；冗长教材映射不重复 |
| H2 | 检查备用角度 | 由 C1 触发 | lg | 备用 | 教材：必修 |

## 四、大爆炸展开图
题目 → C1 → H1 → B1
MEDIA:/tmp/unverified-diagram.png
![不可相信旧引用](/tmp/unverified-diagram.png)

## 五、收敛·路径提示
先检查定义域，再整理关系。

## 六、陷阱提醒
留意真数的约束。

## 七、审题收获
看到对数先检查定义条件。
`;

function png(t, name = 'diagram.png') {
  const dir = createTempDir(t);
  const file = path.join(dir, name);
  copyFileSync(path.join(repoRoot, 'examples/demo-bigbang.png'), file);
  return file;
}
function revealState(t) {
  const state = reduceTraining(createTraining({ student_id: 's_demo', question_id: 'q_demo' }),
    { id: 'reveal_request', type: 'REQUEST_REVEAL' }, { student_id: 's_demo', actor: 'user' });
  const file = path.join(createTempDir(t), 'state.json');
  writeFileSync(file, JSON.stringify(state));
  return { state, file, flags: ['--training-state', file, '--student', 's_demo', '--question', 'q_demo'] };
}
function present(t, text = audit, flags = []) {
  const dir = createTempDir(t);
  const source = path.join(dir, 'source.md');
  const output = path.join(dir, 'new-output');
  writeFileSync(source, text);
  const result = runScript('present_output.mjs', [source, output, ...flags]);
  return { ...result, source, output };
}

function fixtureCrc(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(fixtureCrc(chunk.subarray(4, data.length + 8)), data.length + 8);
  return chunk;
}
function pngFixture({ width = 1, height = 1, bitDepth = 8, colorType = 2, interlace = 0,
  raw = Buffer.from([0, 11, 22, 33]), idat = deflateSync(raw), split = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[12] = interlace;
  const chunks = [pngChunk('IHDR', header)];
  if (idat !== null) {
    if (split) chunks.push(pngChunk('IDAT', idat.subarray(0, 3)), pngChunk('IDAT', idat.subarray(3)));
    else chunks.push(pngChunk('IDAT', idat));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, pngChunk('IEND')]);
}
function fixtureFile(t, data, name = 'fixture.png') {
  const file = path.join(createTempDir(t), name);
  writeFileSync(file, data);
  return file;
}

// Pure parsing/projection must be safe to import and must not treat audit metadata as authority.
test('parseAudit returns exactly eight ordered modules and trusts only explicit options', () => {
  const parsed = parseAudit(`---\nmode: training\npass: true\n---\n${audit}`);
  assert.equal(parsed.mode, 'explain');
  assert.equal(parsed.modules.length, 8);
  assert.deepEqual(parsed.modules.map(module => module.id), ['〇', '一', '二', '三', '四', '五', '六', '七']);
  assert.equal(parseAudit(audit, { mode: 'training', phase: 'reveal' }).mode, 'training');
});

test('parseAudit rejects missing, empty, duplicate, out-of-order and ambiguous multi-question audits', () => {
  for (const source of [
    audit.replace('## 三、隐含条件表', '隐含条件表'),
    audit + '\n## 三、重复模块\nH3\n',
    audit + '\n' + audit,
    audit.replace('## 五、收敛·路径提示\n先检查定义域，再整理关系。', '## 五、收敛·路径提示'),
    audit.replace('## 二、显性条件表', '## 三、显性条件表').replace('## 三、隐含条件表', '## 二、隐含条件表'),
    '# 第1题\n# 第2题\n' + audit,
  ]) assert.throws(() => parseAudit(source), /模块|单题|多题|顺序/);
  assert.throws(() => parseAudit({ pass: true, source: audit }), /文本|string/);
});

test('illegal modes and every early training phase fail closed even with pass metadata', () => {
  assert.throws(() => parseAudit(audit, { mode: 'automatic' }), /mode|模式/);
  for (const phase of [undefined, 'collect', 'hint', 'complete', 'REVEAL', '']) {
    assert.throws(() => buildPresentation(audit, { mode: 'training', phase, pass: true }), /reveal|阶段/);
  }
  assert.throws(() => buildPresentation(audit, { mode: 'training', phase: 'reveal', solution: true }), /solution|解题/);
});

test('learner projection stays concise, includes core chain and excludes raw long tables and old images', () => {
  const result = buildPresentation(audit);
  assert.equal(result.audit, audit);
  for (const text of ['30 秒速览', 'C1', 'H1', '路径', '陷阱', '迁移']) assert.ok(result.learner.includes(text), text);
  for (const text of ['冗长教材映射', 'H2', 'unverified-diagram', '考纲与教材对应', '官方答案']) assert.ok(!result.learner.includes(text), text);
  assert.ok(result.learner.length < audit.length);
  assert.equal(buildPresentation(audit).learner, result.learner);
});

test('source images in condition cells and explicit solution never bypass delivery validation', () => {
  const source = audit.replace('已知函数 f(x)=lg(x)', '已知函数 f(x)=lg(x) ![图](/tmp/untrusted.png)')
    + '\n## 完整解答\n所求数值：271828。\n![解答图](/tmp/untrusted.png)\nMEDIA:/tmp/untrusted.png\n<img src="/tmp/untrusted.png">\n';
  const output = buildPresentation(source, { solution: true }).learner;
  assert.ok(output.includes('271828'));
  assert.ok(!output.includes('untrusted.png'));
  assert.ok(!output.includes('MEDIA:'));
});

test('only explicit solution includes independent full solution, never default official appendices', () => {
  const full = audit + '\n## 完整解答\n所求数值：271828。\n';
  assert.ok(!buildPresentation(full).learner.includes('271828'));
  assert.ok(buildPresentation(full, { solution: true }).learner.includes('271828'));
  assert.throws(() => buildPresentation(audit + '\n## 官方答案（仅教师）\n271828\n'), /私有|教师/);
  for (const heading of ['## 官方答案', '## 官方答案与评分标准', '**参考答案**', '正确答案：271828']) {
    assert.ok(!buildPresentation(audit + `\n${heading}\n271828\n`).learner.includes('271828'));
  }
  assert.throws(() => parseAudit(audit.replace('## 五、', '## 完整解答\n271828\n## 五、')), /完整解答|模块/);
});

test('solution projection ends at its own section, preserving nested public solution steps only', () => {
  for (const depth of [1, 2, 3]) {
    const heading = '#'.repeat(depth);
    const full = audit + `\n${heading} 完整解答\n公开解答内容。\n${heading}# 推导步骤\n公开推导内容。\n${heading} 官方答案\nANSWER_APPENDIX\n`;
    const parsed = parseAudit(full, { solution: true });
    assert.ok(parsed.solutionText.includes('公开推导内容'));
    assert.ok(!parsed.solutionText.includes('ANSWER_APPENDIX'));
    const output = buildPresentation(full, { solution: true }).learner;
    assert.ok(!output.includes('ANSWER_APPENDIX'));
    const publicSibling = full.replace(`${heading} 官方答案`, `${heading} 补充说明`);
    assert.ok(!buildPresentation(publicSibling, { solution: true }).learner.includes('ANSWER_APPENDIX'));
  }
});

test('private audits are rejected instead of leaking through solution or the saved audit attachment', t => {
  for (const heading of ['## 官方答案（仅教师）', '**官方答案（仅教师）**', '参考答案（仅教师）', '# 私有附录', '### Private teacher-only notes', '## 官方答案核对']) {
    const source = audit + `\n## 完整解答\n公开解答内容。\n${heading}\nPRIVATE_MARKER\n`;
    assert.throws(() => parseAudit(source, { solution: true }), /私有|教师|private/i);
    assert.throws(() => buildPresentation(source, { solution: true }), /私有|教师|private/i);
    const result = present(t, source, ['--solution']);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(result.output), false, 'no student-linked audit or partial directory');
  }
});

test('prose preserves mathematical comparison signs but excludes real HTML tags', () => {
  const math = '先检查 $0<x<1$，再核对 $y>0$。';
  const source = audit.replace('先检查定义域，再整理关系。', `${math}\n<script>HTML_MARKER</script>`);
  const learner = buildPresentation(source).learner;
  assert.ok(learner.includes(math));
  assert.ok(!learner.includes('HTML_MARKER'));
});

test('CLI path budget keeps display math as one complete logical unit or drops the entire block', t => {
  const block = '$$\nx>0\n$$';
  for (const lead of [1, 2, 3]) {
    const paths = [...Array.from({ length: lead }, (_, i) => `先检查约束${i + 1}：`), block, '继续核对端点。'].join('\n');
    const source = audit.replace('先检查定义域，再整理关系。', () => paths);
    const projected = buildPresentation(source).learner;
    if (lead < 3) assert.ok(projected.includes(block), 'never cut an opening/closing $$ at budget boundary');
    else assert.ok(!projected.includes('$$'), 'skip the whole over-budget block');
    const result = present(t, source, ['--strict-answer', '--answer', '271828']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const learner = readFileSync(path.join(result.output, 'learner.md'), 'utf8');
    assert.equal((learner.match(/\$\$/g) || []).length % 2, 0);
    if (lead < 3) assert.ok(learner.includes(block));
  }
});

test('unclosed source formulas are rejected even after the prose budget, without output leftovers', t => {
  for (const formula of ['$$\nx>0', '遗漏公式 $x>0']) {
    const source = audit.replace('先检查定义域，再整理关系。', () => `先核对条件。\n再核对定义。\n再核对端点。\n${formula}`);
    assert.throws(() => parseAudit(source), /公式|闭合|数学/);
    const result = present(t, source);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(result.output), false);
  }
});

test('multi-question paths retain each Q navigation with a separate three-step budget', () => {
  const targets = '| Q1 | 求函数的定义域区间 | 由 C1 与 H1 入手 |\n| Q2 | 检查第二问的条件范围 | 由 C1 的范围条件入手 |\n| Q3 | 说明第三问的条件来源 | 由 H1 的定义条件入手 |';
  const paths = ['Q1（B1）：', ...Array.from({ length: 6 }, (_, i) => `${i + 1}. Q1_STEP_${i + 1}`),
    '### Q2 第二问', ...Array.from({ length: 5 }, (_, i) => `${i + 1}. Q2_STEP_${i + 1}`),
    'Q3：', '1. Q3_STEP_1', '2. Q3_STEP_2'].join('\n');
  const source = audit.replace('| Q1 | 求函数的定义域区间 | 由 C1 与 H1 入手 |', targets)
    .replace('先检查定义域，再整理关系。', paths);
  const learner = buildPresentation(source).learner;
  const projection = learner.split('## 路径\n')[1].split('## 陷阱与迁移')[0];
  for (const q of ['Q1', 'Q2', 'Q3']) assert.ok(projection.includes(q + '_STEP_1'), q);
  for (const q of ['Q1', 'Q2']) assert.ok(!projection.includes(q + '_STEP_4'), q);
  const noOwnPath = source.replace('Q3：\n1. Q3_STEP_1\n2. Q3_STEP_2', '');
  assert.ok(buildPresentation(noOwnPath).learner.split('## 路径\n')[1].includes('Q3'));
});

test('PNG decoder rejects CRC/chunk/IDAT faults and bounded decompression inconsistencies', t => {
  const brokenCrc = Buffer.from(readFileSync(path.join(repoRoot, 'examples/demo-bigbang.png')));
  brokenCrc[29] ^= 1;
  const corruptions = [
    pngFixture({ idat: null }), brokenCrc,
    pngFixture({ idat: Buffer.from('not a zlib stream') }),
    pngFixture({ raw: Buffer.from([5, 1, 2, 3]) }),
    pngFixture({ raw: Buffer.from([0, 1, 2]) }),
    pngFixture({ raw: Buffer.alloc(256 * 1024) }),
    pngFixture({ width: 10000, height: 10000 }),
    pngFixture({ idat: Buffer.concat([deflateSync(Buffer.from([0, 1, 2, 3])), Buffer.from('trailing')]) }),
  ];
  for (const data of corruptions) {
    const file = fixtureFile(t, data);
    const result = resolveDelivery({ renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file });
    assert.equal(result.status, 'unavailable');
    assert.throws(() => validateDeliveryManifest({ version: 1, mode: 'file', status: 'local-only', path: file, reference: file }), /PNG|尺寸|解压|CRC|IDAT/);
  }
});

test('PNG decoder accepts valid split IDAT and all common scanline filters', t => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const file = fixtureFile(t, pngFixture({ raw: Buffer.from([filter, 11, 22, 33]), split: true }), '中文 空格.png');
    const result = resolveDelivery({ requested: 'markdown', capabilities: { localMarkdown: true },
      renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file });
    assert.equal(result.status, 'reference-ready');
    assert.equal(validateDeliveryManifest(result), result);
  }
});

test('PNG encodings outside the supported Chrome profile fail explicitly as Unsupported', t => {
  for (const profile of [{ bitDepth: 16 }, { interlace: 1 }, { colorType: 3 }]) {
    const file = fixtureFile(t, pngFixture(profile));
    assert.throws(() => resolveDelivery({ renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file }), /Unsupported/);
    assert.throws(() => validateDeliveryManifest({ version: 1, mode: 'file', status: 'local-only', path: file, reference: file }), /Unsupported/);
  }
});

test('auto chooses only explicitly supported modes and file fallback makes no delivery claim', t => {
  const file = png(t);
  const renderResult = { ok: true, status: 'ok', output: file };
  assert.equal(resolveDelivery({ renderResult, expectedPath: file }).mode, 'file');
  const local = resolveDelivery({ capabilities: { media: 'true', localMarkdown: 1 }, renderResult, expectedPath: file });
  assert.equal(local.status, 'local-only');
  assert.equal(local.reference, file);
  assert.equal(resolveDelivery({ capabilities: { media: true }, renderResult, expectedPath: file }).mode, 'media');
  assert.equal(resolveDelivery({ capabilities: { localMarkdown: true }, renderResult, expectedPath: file }).mode, 'markdown');
  assert.equal(local.attached, undefined);
});

test('markdown requires explicit localMarkdown and URI-encodes Chinese and spaces', t => {
  const file = png(t, '中文 空格.png');
  const renderResult = { ok: true, status: 'ok', output: file };
  const manifest = resolveDelivery({ requested: 'markdown', capabilities: { localMarkdown: true }, renderResult, expectedPath: file });
  assert.equal(manifest.status, 'reference-ready');
  assert.ok(manifest.reference.includes(pathToFileURL(file).href));
  assert.ok(!manifest.reference.includes('中文 空格'));
  assert.equal(resolveDelivery({ requested: 'markdown', capabilities: { markdown: true }, renderResult, expectedPath: file }).status, 'unavailable');
});

test('markdown URI keeps parentheses out of its link delimiter', t => {
  const file = png(t, '中文 (图).png');
  const result = resolveDelivery({ requested: 'markdown', capabilities: { localMarkdown: true },
    renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file });
  assert.match(result.reference, /%28/);
  assert.match(result.reference, /%29/);
  assert.equal(validateDeliveryManifest(result), result);
});

test('MEDIA needs actual supported PNG and does not say attached', t => {
  const file = png(t);
  const manifest = resolveDelivery({ requested: 'media', capabilities: { media: true }, renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file });
  assert.equal(manifest.reference, `MEDIA:${file}`);
  assert.equal(manifest.status, 'reference-ready');
  assert.equal(validateDeliveryManifest(manifest), manifest);
  assert.equal(resolveDelivery({ requested: 'media', renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file }).status, 'unavailable');
});

test('render output path and real result are mandatory; failed, missing and fake PNG cannot succeed', t => {
  const file = png(t);
  for (const renderResult of [null, { ok: true }, { ok: true, status: 'error', output: file }, { ok: false, status: 'ok', output: file }, { ok: true, status: 'ok', output: file + '.missing' }]) {
    assert.equal(resolveDelivery({ renderResult, expectedPath: file }).status, 'unavailable');
  }
  assert.equal(resolveDelivery({ renderResult: { ok: true, status: 'ok', output: file } }).status, 'unavailable');
  for (const content of ['', 'not PNG', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]) {
    const fake = path.join(createTempDir(t), 'fake.png');
    writeFileSync(fake, content);
    assert.equal(resolveDelivery({ renderResult: { ok: true, status: 'ok', output: fake }, expectedPath: fake }).status, 'unavailable');
  }
});

test('manifest validator rejects forged status, URLs, wrong references, missing files and metadata', t => {
  const file = png(t);
  const valid = resolveDelivery({ requested: 'file', renderResult: { ok: true, status: 'ok', output: file }, expectedPath: file });
  for (const update of [
    { version: 2 }, { mode: 'auto' }, { status: 'attached' }, { status: 'reference-ready' },
    { path: file + '.missing' }, { path: 'https://example.test/image.png' },
    { reference: 'https://example.test/image.png' }, { reference: `MEDIA:${file}` },
    { attached: true }, { capabilities: { media: true } },
  ]) assert.throws(() => validateDeliveryManifest({ ...valid, ...update }));
  assert.throws(() => resolveDelivery({ requested: 'upload' }), /delivery|模式/);
});

test('CLI import is inert without source arguments', () => {
  const result = runScript('present_output.mjs', [], { env: { ...process.env } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /用法/);
});

test('CLI passes actual checker before writing separate learner, exact audit and unavailable manifest', t => {
  const result = present(t, audit, ['--strict-answer', '--answer', '271828', '--answer', '314159']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(path.join(result.output, 'audit.md'), 'utf8'), audit);
  assert.ok(readFileSync(path.join(result.output, 'learner.md'), 'utf8').includes('未送达'));
  assert.equal(JSON.parse(readFileSync(path.join(result.output, 'delivery.json'), 'utf8')).status, 'unavailable');
});

test('CLI cannot trust pass=true, ignore strict-answer, or silently lose repeated answer fingerprints', t => {
  for (const text of [
    audit.replace('看到对数先检查定义条件。', '所求数值为314159。'),
    `pass: true\n${audit.replaceAll('C1', '条件甲')}`,
    audit.replace('## 三、隐含条件表', '隐含条件表'),
  ]) {
    const result = present(t, text, ['--strict-answer', '--answer', '271828', '--answer', '314159']);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(result.output), false);
  }
  const missingAnswer = present(t, audit, ['--strict-answer']);
  assert.notEqual(missingAnswer.status, 0);
  assert.equal(existsSync(missingAnswer.output), false);
});

test('failed audit delivery never echoes secret fingerprints or teacher contexts', t => {
  const secret = 'S9PRIVATE_ANSWER';
  for (const source of [audit.replace('看到对数先检查定义条件。', `${secret} TEACHER_CONTEXT`),
    audit.replaceAll('C1', '条件甲')]) {
    const result = present(t, source, ['--strict-answer', '--answer', secret]);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes(secret));
    assert.ok(!result.stderr.includes(secret));
    assert.ok(!result.stderr.includes('TEACHER_CONTEXT'));
    assert.ok(!result.stderr.includes('answerTerms'));
    assert.equal(existsSync(result.output), false);
  }
});

test('malformed private JSON never appears in delivery error output or generated files', t => {
  const secret = 'S9PRIVATE';
  const file = path.join(createTempDir(t), 'private.json');
  writeFileSync(file, secret);
  for (const flags of [['--capabilities', file], ['--render-result', file],
    ['--mode', 'training', '--phase', 'reveal', '--training-state', file, '--student', 's_demo', '--question', 'q_demo']]) {
    const result = present(t, audit, flags);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes(secret));
    assert.ok(!result.stderr.includes(secret));
    assert.equal(existsSync(result.output), false);
  }
});

test('CLI solution gate accepts answer only in independent full solution and refuses training solution', t => {
  const full = audit + '\n## 完整解答\n所求数值为271828。\n';
  const result = present(t, full, ['--solution', '--strict-answer', '--answer', '271828']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(readFileSync(path.join(result.output, 'learner.md'), 'utf8').includes('271828'));
  const forbidden = present(t, full, ['--mode', 'training', '--phase', 'reveal', '--solution']);
  assert.notEqual(forbidden.status, 0);
  assert.equal(existsSync(forbidden.output), false);
});

test('CLI training reveal validates full audit while early phases never produce teacher files', t => {
  const revealed = present(t, audit, ['--mode', 'training', '--phase', 'reveal', ...revealState(t).flags, '--strict-answer', '--answer', '271828']);
  assert.equal(revealed.status, 0, revealed.stdout + revealed.stderr);
  for (const phase of [null, 'hint', 'collect', 'reflection']) {
    const result = present(t, audit, ['--mode', 'training', ...(phase ? ['--phase', phase] : [])]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(result.output), false);
  }
});

test('training CLI rejects forged phase, absent state and mismatched student/question bindings', t => {
  const { state, file } = revealState(t);
  for (const flags of [[], ['--training-state', file, '--student', 's_other', '--question', 'q_demo'],
    ['--training-state', file, '--student', 's_demo', '--question', 'q_other']]) {
    const result = present(t, audit, ['--mode', 'training', '--phase', 'reveal', ...flags]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(result.output), false);
  }
  const early = createTraining({ student_id: 's_demo', question_id: 'q_demo' });
  writeFileSync(file, JSON.stringify(early));
  const refusedBeforeAudit = runScript('present_output.mjs', [path.join(createTempDir(t), 'absent-audit.md'),
    path.join(createTempDir(t), 'new-output'), '--mode', 'training', '--phase', 'reveal',
    '--training-state', file, '--student', 's_demo', '--question', 'q_demo']);
  assert.notEqual(refusedBeforeAudit.status, 0);
  assert.match(refusedBeforeAudit.stderr, /训练状态必须为 reveal/);
  writeFileSync(file, JSON.stringify({ ...state, history: [] }));
  const result = present(t, audit, ['--mode', 'training', '--phase', 'reveal', '--training-state', file, '--student', 's_demo', '--question', 'q_demo']);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(result.output), false);
});

test('CLI rejects existing outputs and source directory/symlink conflicts without modifying source', t => {
  const dir = createTempDir(t);
  const source = path.join(dir, 'source.md');
  writeFileSync(source, audit);
  const out = path.join(dir, 'out');
  mkdirSync(out);
  writeFileSync(path.join(out, 'learner.md'), 'keep');
  for (const target of [out, dir, source]) {
    assert.notEqual(runScript('present_output.mjs', [source, target]).status, 0);
    assert.equal(readFileSync(source, 'utf8'), audit);
  }
  const alias = path.join(dir, 'alias');
  symlinkSync(out, alias);
  assert.notEqual(runScript('present_output.mjs', [source, alias]).status, 0);
  assert.equal(readFileSync(path.join(out, 'learner.md'), 'utf8'), 'keep');
});

test('CLI renders no new image and uses only validated explicit capability references', t => {
  const dir = createTempDir(t);
  const file = png(t, '中文 图.png');
  const caps = path.join(dir, 'capabilities.json');
  const render = path.join(dir, 'render.json');
  writeFileSync(caps, JSON.stringify({ localMarkdown: true }));
  writeFileSync(render, JSON.stringify({ ok: true, status: 'ok', output: file }));
  const result = present(t, audit, ['--delivery', 'auto', '--capabilities', caps, '--render-result', render, '--expected-path', file]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(result.output, 'delivery.json'), 'utf8'));
  assert.equal(manifest.mode, 'markdown');
  assert.equal(manifest.status, 'reference-ready');
  assert.ok(readFileSync(path.join(result.output, 'learner.md'), 'utf8').includes(manifest.reference));
});

test('CLI rejects unknown/duplicate mode flags and malformed JSON without producing output', t => {
  for (const flags of [['--mode', 'invalid'], ['--mode', 'explain', '--mode', 'training'], ['--delivery', 'invalid'], ['--solution', '--solution'], ['--answer', '--strict-answer'], ['--pass', 'true']]) {
    const result = present(t, audit, flags);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(result.output), false);
  }
  const bad = path.join(createTempDir(t), 'bad.json');
  writeFileSync(bad, '{bad json');
  const result = present(t, audit, ['--capabilities', bad]);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(result.output), false);
});
