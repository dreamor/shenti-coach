import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeQuestion, parseOptions } from '../lib/question.mjs';
import { assertRenderableText, normalizeMathText, toMermaidLabel } from '../lib/text.mjs';
import { createTempDir, runScript } from './helpers.mjs';

const optionSummary = (raw) => parseOptions(raw).options.map(({ label, text, images }) => ({ label, text, images }));

for (const [source, expected] of [
  ['x^{ab}', 'x^{ab}'],
  ['a_{ij}', 'a_{ij}'],
  ['x^{n+ab}', 'x^{n+ab}'],
  ['x^{a_{ij}}', 'x^{a_{ij}}'],
  ['x^a', 'x^{a}'],
  ['x^{n+1}+a_{12}', 'xⁿ⁺¹+a₁₂'],
  [String.raw`$\frac{x^{ab}}{a_{ij}}$`, '(x^{ab})/(a_{ij})'],
  [String.raw`$\ce{H2O + FeO4^2-}$`, 'H₂O + FeO₄²⁻'],
]) {
  test(`formula semantics and repeated normalization: ${source}`, () => {
    const normalized = normalizeMathText(source);
    assert.equal(normalized, expected);
    assert.equal(normalizeMathText(normalized), expected);
    assert.equal(normalizeMathText(normalizeMathText(normalized)), expected);
    assert.equal(toMermaidLabel(normalized), expected);
    assert.doesNotThrow(() => assertRenderableText(normalized));
  });
}

test('unknown commands stay visible and fail renderability checks', () => {
  const normalized = normalizeMathText(String.raw`x^{\unknown{a}}`);
  assert.match(normalized, /\\unknown/);
  assert.throws(() => assertRenderableText(normalized), /LaTeX/);
  assert.throws(() => assertRenderableText('$x$'), /定界符/);
});

test('labeled options keep multiline continuations inside their option', () => {
  const raw = 'A. 第一行\n续行仍属于 A\nB. 第二项\nC. 第三项\nD. 第四项';
  assert.deepEqual(optionSummary(raw), [
    { label: 'A', text: '第一行\n续行仍属于 A', images: [] },
    { label: 'B', text: '第二项', images: [] },
    { label: 'C', text: '第三项', images: [] },
    { label: 'D', text: '第四项', images: [] },
  ]);
  assert.deepEqual(optionSummary('A: 第一行\r\n续行\r\nB：第二项'), [
    { label: 'A', text: '第一行\r\n续行', images: [] },
    { label: 'B', text: '第二项', images: [] },
  ]);
  assert.equal(optionSummary('A. 唯一选项\n续行').length, 1);
});

test('adjacent labeled options split at markers without whitespace', () => {
  assert.deepEqual(optionSummary('A.甲B.乙C.丙D.丁'), [
    { label: 'A', text: '甲', images: [] },
    { label: 'B', text: '乙', images: [] },
    { label: 'C', text: '丙', images: [] },
    { label: 'D', text: '丁', images: [] },
  ]);
  assert.deepEqual(optionSummary(['A.甲B.乙', '丙']), [
    { label: 'A', text: '甲B.乙', images: [] },
    { label: 'B', text: '丙', images: [] },
  ]);
});

test('lowercase function notation is not a top-level option marker', () => {
  assert.deepEqual(optionSummary('A. 函数 f: R→R 为奇函数\nB. 函数为偶函数\nC. 函数为增函数\nD. 函数为减函数'), [
    { label: 'A', text: '函数 f: R→R 为奇函数', images: [] },
    { label: 'B', text: '函数为偶函数', images: [] },
    { label: 'C', text: '函数为增函数', images: [] },
    { label: 'D', text: '函数为减函数', images: [] },
  ]);
  assert.deepEqual(optionSummary(['a. 第一项', 'b. 第二项']), [
    { label: 'A', text: '第一项', images: [] },
    { label: 'B', text: '第二项', images: [] },
  ]);
});

test('bare top-level line options and inline labeled options remain compatible', () => {
  assert.deepEqual(optionSummary('第一项\n第二项'), [
    { label: 'A', text: '第一项', images: [] },
    { label: 'B', text: '第二项', images: [] },
  ]);
  assert.deepEqual(optionSummary('A．第一项 B、第二项 C: 第三项'), [
    { label: 'A', text: '第一项', images: [] },
    { label: 'B', text: '第二项', images: [] },
    { label: 'C', text: '第三项', images: [] },
  ]);
});

test('array elements are individual options and do not reset fallback labels', () => {
  const raw = ['第一项', '第二项\n第二项续行', 'C. 第三项\n第三项续行', '第四项'];
  const expected = [
    { label: 'A', text: '第一项', images: [] },
    { label: 'B', text: '第二项\n第二项续行', images: [] },
    { label: 'C', text: '第三项\n第三项续行', images: [] },
    { label: 'D', text: '第四项', images: [] },
  ];
  assert.deepEqual(optionSummary(raw), expected);
  assert.deepEqual(optionSummary(JSON.stringify(raw)), expected);
  assert.equal(parseOptions(raw).format, 'list');
});

test('option object arrays, dictionaries, images and input shapes are preserved', () => {
  const items = [{ key: 'A:', content: '甲\n续行', image: '/a.png' }, { letter: 'b', value: '乙', images: ['b.png'] }, '丙'];
  const expected = [
    { label: 'A', text: '甲\n续行', images: ['/a.png'] },
    { label: 'B', text: '乙', images: ['b.png'] },
    { label: 'C', text: '丙', images: [] },
  ];
  for (const raw of [items, JSON.stringify(items)]) {
    assert.deepEqual(optionSummary(raw), expected);
    assert.equal(parseOptions(raw).format, 'list-object');
  }
  const dict = { A: { text: '甲', img: 'a.png' }, b: '乙', __raw__: 'ignored' };
  for (const raw of [dict, JSON.stringify(dict)]) {
    assert.equal(parseOptions(raw).format, 'dict');
    assert.deepEqual(optionSummary(raw), [
      { label: 'A', text: '甲', images: ['a.png'] },
      { label: 'B', text: '乙', images: [] },
    ]);
  }
  for (const raw of [null, undefined, '']) assert.deepEqual(parseOptions(raw), { format: 'none', options: [] });
  assert.deepEqual(parseOptions(42), { format: 'unknown', options: [] });
});

test('normalization preserves stem/option image ownership and continuous G numbering', (t) => {
  const dir = createTempDir(t);
  for (const name of ['stem.png', 'a.png', 'b.png']) writeFileSync(path.join(dir, name), 'fixture');
  const normalized = normalizeQuestion({
    type: '单项选择题', stem: '[图] 选择正确项', images: ['/stem.png', '/a.png', '/b.png'],
    options: [{ text: '甲\n续行', image: '/a.png' }, { text: '乙', image: '/b.png' }],
  }, { publicRoot: dir });
  assert.equal(normalized.kind, 'choice');
  assert.deepEqual(normalized.figures.map(({ id, path: imagePath, role, option }) => ({ id, imagePath, role, option })), [
    { id: 'G1', imagePath: '/stem.png', role: 'stem', option: undefined },
    { id: 'G2', imagePath: '/a.png', role: 'option', option: 'A' },
    { id: 'G3', imagePath: '/b.png', role: 'option', option: 'B' },
  ]);
  assert.deepEqual(normalized.warnings, []);
});

function preflight(t, questions) {
  const dir = createTempDir(t);
  const input = path.join(dir, 'normalized.jsonl');
  const output = path.join(dir, 'audit.jsonl');
  const summary = path.join(dir, 'summary.json');
  const rows = questions.map((q, i) => normalizeQuestion({
    subject: '数学', region: '测试', year: 2026, seq: i + 1, type: '解答题', ...q,
  }, { publicRoot: dir }));
  writeFileSync(input, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const result = runScript('preflight_question.mjs', [input, '--jsonl-out', output, '--summary-out', summary]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const audited = readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(JSON.parse(readFileSync(summary, 'utf8')).total, questions.length);
  return { rows, audited };
}

for (const [stem, expectedBlanks, expectedSlots] of [
  ['（1）判断是否成立：____，并说明理由。', 1, 2],
  ['（1）a=____，b=____，并说明理由。', 2, 3],
  ['（1）a=____，b=____，并说明理由：____。', 3, 3],
  ['（1）a=____，理由是____。', 2, 2],
  ['（1）a=____。说明理由。', 1, 2],
  ['（1）a=____，证明该结果。', 1, 2],
  ['（1）a=____，说明理由：因为____。', 2, 2],
  ['（1）判断是否成立，并说明理由。', 0, 2],
  ['（1）求 a 的值。', 0, 1],
  ['（1）理由是____。', 1, 1],
  ['（1）a=____并说明理由。', 1, 2],
  ['（1）a=____，并说明理由\n____。', 2, 2],
  ['（1）a=____，并说明理由，因为____。', 2, 2],
]) {
  test(`preflight counts explicit blanks plus independent demands: ${stem}`, (t) => {
    const { audited: [row] } = preflight(t, [{ stem, answer: '核对答案' }]);
    assert.equal(row.blanks, expectedBlanks);
    assert.equal(row.answer_slots, expectedSlots);
    assert.equal(row.implicit_answer_slots.length, expectedSlots - expectedBlanks);
    assert.equal(row.subquestions, 1);
  });
}

test('unnumbered demands count only real non-choice tasks, keeping subquestions at zero', (t) => {
  const fixtures = [
    { stem: '已知 a+1=2，求 a 的值。', answer: '1', expected: 1 },
    { stem: '已知 a+1=2。', answer: '1；另一段；再一段', expected: 0 },
    { stem: '函数的定义域说明了自变量的范围。', expected: 0 },
    { stem: '该方案是否可行尚不清楚。', expected: 0 },
    { stem: '（1）求 a 的值。', type: '单项选择题', options: ['1', '2', '3', '4'], expected: 0 },
    { stem: '求 a 的值，选择正确项。', type: '单项选择题', options: ['1', '2', '3', '4'], expected: 0 },
    { stem: '求 a 的值，选择所有正确项。', type: '多项选择题', options: ['1', '2', '3', '4'], expected: 0 },
    { stem: 'a=____，b=____，并说明理由。', expected: 3 },
    { stem: 'a=____，并说明理由：____。', expected: 2 },
  ];
  const { rows, audited } = preflight(t, fixtures);
  fixtures.forEach((fixture, i) => {
    assert.equal(audited[i].answer_slots, fixture.expected, fixture.stem);
    const count = fixture.stem.startsWith('（1）') ? 1 : 0;
    assert.equal(rows[i].subquestions.length, count);
    assert.equal(audited[i].subquestions, count);
  });
});

for (const [stem, expectedBlanks, expectedSlots, expectedSubquestions] of [
  ['已知函数 f(x)=x²，画出该函数的图像。', 0, 1, 0],
  ['（1）速度为____，求物体在2s内的位移。', 1, 2, 1],
  ['求 a 的值，并证明 a>0。', 0, 2, 0],
  ['求 a 的值并证明 a>0。', 0, 2, 0],
  ['（1）求 a 的值：____并证明 a>0。', 1, 2, 1],
  ['（1）判断结果为____，并说明理由，答：____。', 2, 2, 1],
  ['（1）该方案是否可行？说明理由。', 0, 2, 1],
  ['（1）求 a 的值，结果为____。', 1, 1, 1],
  ['求a值，a=____。', 1, 1, 0],
]) {
  test(`preflight recognizes independent actions and their answer continuations: ${stem}`, (t) => {
    const { audited: [row] } = preflight(t, [{ stem }]);
    assert.equal(row.blanks, expectedBlanks);
    assert.equal(row.answer_slots, expectedSlots);
    assert.equal(row.subquestions, expectedSubquestions);
  });
}

test('official answer segmentation never dictates question-side slot counts', (t) => {
  const stem = '已知 a+1=2，求 a 的值。';
  const { audited } = preflight(t, [
    { stem },
    { stem, answer: '1' },
    { stem, answer: '（1）①1；②2；③3；（2）其他' },
  ]);
  assert.deepEqual(audited.map((row) => row.answer_slots), [1, 1, 1]);
  assert.equal(audited[0].subquestions, 0);
});
