import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildHtmlWithReport, validateSpec } from '../build_bigbang.mjs';
import { createTempDir, repoRoot, runScript } from './helpers.mjs';

const demo = JSON.parse(readFileSync(path.join(repoRoot, 'examples/demo-spec.json'), 'utf8'));

function groupedSpec() {
  const spec = structuredClone(demo);
  spec.groups = [{ id: 'GROUP_Q1', label: '小问条件', nodes: ['C1', 'H1'] }];
  return spec;
}

test('正常规格与分组在内存中生成 HTML', () => {
  for (const spec of [demo, groupedSpec()]) {
    const result = buildHtmlWithReport(spec);
    assert.ok(result.html.includes('flowchart LR'));
    assert.ok(result.html.includes('data-status="pending"'));
    assert.deepEqual(result.warnings, []);
  }
});

test('所有学生可见字段都拒绝答案指纹', () => {
  const changes = [
    spec => { spec.title = '所求数值为271828'; },
    spec => { spec.subtitle = '所求数值为271828'; },
    spec => { spec.footnote = '所求数值为271828'; },
    spec => { spec.nodes[0].text = '所求数值为271828'; },
    spec => { spec.edges[0].label = '所求数值为271828'; },
    spec => { spec.groups[0].label = '所求数值为271828'; },
  ];
  for (const change of changes) {
    const spec = groupedSpec();
    change(spec);
    assert.throws(() => validateSpec(spec, { forbidTerms: ['271828'] }), /命中答案指纹/);
    assert.throws(() => buildHtmlWithReport(spec, { forbidTerms: ['271828'] }), /命中答案指纹/);
  }
});

test('指纹与可见文案使用相同公式规范化，不能靠转写绕过', () => {
  for (const field of ['title', 'subtitle', 'footnote', 'node', 'edge', 'group']) {
    const spec = groupedSpec();
    if (field === 'node') spec.nodes[0].text = 'z^2';
    else if (field === 'edge') spec.edges[0].label = 'z^2';
    else if (field === 'group') spec.groups[0].label = 'z^2';
    else spec[field] = 'z^2';
    assert.throws(() => buildHtmlWithReport(spec, { forbidTerms: ['z²'] }), /命中答案指纹/);
    assert.throws(() => buildHtmlWithReport(spec, { forbidTerms: ['z^2'] }), /命中答案指纹/);
  }
});

test('分组标题中的高风险结论产生警告', () => {
  const spec = groupedSpec();
  spec.groups[0].label = '正确答案';
  assert.ok(validateSpec(spec).warnings.some(warning => warning.includes('GROUP_Q1') && warning.includes('答案')));
});

test('缺失分组标题时，实际显示的 id 也要检查指纹', () => {
  const spec = groupedSpec();
  spec.groups[0].id = 'GROUP_271828';
  delete spec.groups[0].label;
  assert.throws(() => buildHtmlWithReport(spec, { forbidTerms: ['271828'] }), /命中答案指纹/);
});

test('规格错误仍被拒绝', () => {
  const spec = structuredClone(demo);
  spec.edges[0].to = 'MISSING_NODE';
  assert.throws(() => validateSpec(spec), /不存在的节点/);
});

test('讲解与训练默认脚注符合模式', () => {
  const explain = buildHtmlWithReport(demo).html;
  const training = buildHtmlWithReport({ ...demo, mode: 'training' }).html;
  assert.ok(explain.includes('讲解模式配图'));
  assert.ok(training.includes('只在第3步'));
  assert.ok(training.includes('第1、2步不出图'));
});

test('renderer 在写 HTML 或启动 Chrome 前拒绝分组答案', t => {
  const dir = createTempDir(t);
  const spec = groupedSpec();
  spec.groups[0].label = '所求数值为271828';
  const input = path.join(dir, 'spec.json');
  const png = path.join(dir, 'output.png');
  writeFileSync(input, JSON.stringify(spec));
  const result = runScript('render_bigbang.mjs', [input, png, '--forbid', '271828'], { cwd: dir });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).status, 'invalid-spec');
  assert.equal(existsSync(path.join(dir, 'spec.html')), false);
  assert.equal(existsSync(png), false);
});
