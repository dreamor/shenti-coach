import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTempDir, repoRoot, runScript } from './helpers.mjs';

// Only guard the approved reliability contracts and the bundled example.
// This is not a general Markdown linter or a semantic review of generated answers.
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
const skill = read('SKILL.md');
const libs = read('references/subject-libs.md');
const isolation = read('references/answer-isolation.md');
const playbooks = read('references/question-type-playbooks.md');
const modes = read('references/modes-and-input.md');
const example = read('references/example.md');
const textbookMap = read('references/liaoning-textbook-map.md');
const spec = JSON.parse(read('examples/demo-spec.json'));

function between(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `Missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing section: ${end}`);
  return text.slice(from + start.length, to);
}

function tableRows(text) {
  return text.split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

test('strict monotonicity requires differentiability and excludes every constant segment', () => {
  const rule = libs.split('\n').find((line) => line.startsWith('- “单调递增”'));
  assert.ok(rule);
  assert.match(rule, /区间内部可导/);
  assert.match(rule, /端点连续/);
  assert.match(rule, /f′ ≥ 0/);
  assert.match(rule, /任意非退化子区间上不恒为 0/);
  assert.match(rule, /排除常值段/);
  assert.match(rule, /整个区间上“不恒为 0”不够/);
  assert.match(rule, /f′ > 0.*充分条件.*不是必要条件/);
  assert.doesNotMatch(rule, /或导数 ≥ 0 且不恒为 0/);
});

test('motion signals distinguish inertial straight-line motion, endpoints and acceleration components', () => {
  const uniform = libs.split('\n').find((line) => line.startsWith('- "匀速"'));
  const maximum = libs.split('\n').find((line) => line.startsWith('- "速度最大/速率最大"'));
  assert.ok(uniform);
  assert.ok(maximum);
  assert.match(uniform, /惯性参考系中的匀速直线运动.*合力为零/);
  assert.match(uniform, /匀速曲线运动.*法向加速度/);
  assert.match(maximum, /速度分量与速率/);
  assert.match(maximum, /内部.*可导极值/);
  assert.match(maximum, /仅能推切向加速度为零/);
  assert.match(maximum, /不能直接推总加速度或合力为零/);
  assert.match(maximum, /端点最大值不保证导数为零/);
  assert.doesNotMatch(libs, /"速度最大"→加速度为零/);
});

test('terminology hints use condition anchors, not complete definitions that identify the answer', () => {
  const rule = isolation.split('\n').find((line) => line.startsWith('- **答案本身是教材术语时**'));
  assert.ok(rule);
  assert.match(rule, /判断维度与条件锚点/);
  assert.match(rule, /不能用完整定义或唯一可识别的过程描述/);
  assert.match(rule, /逆转录.*由 Cn 的模板与产物信息核对遗传信息传递方向/);
  assert.match(rule, /感受态.*由 Cn 的受体处理条件核对外源 DNA 导入所需的细胞状态/);
  assert.match(rule, /Cn 必须替换为题面实际条件编号/);
  assert.match(rule, /不补出题干未给的信息/);
  assert.doesNotMatch(rule, /以 RNA 为模板合成 DNA 的信息流/);
  assert.doesNotMatch(rule, /Ca²⁺ 处理后易于吸收外源 DNA 的生理状态/);
});

test('answer isolation covers all eight modules, including the teaching takeaway', () => {
  assert.doesNotMatch(isolation, /`〇`–`六`/);
  assert.doesNotMatch(playbooks, /`〇`–`六`/);
  assert.match(isolation, /八模块讲解区（`〇`–`七`）/);
  assert.match(isolation, /`七、审题收获`.*同样不得写答案，没有整块豁免/);
  assert.match(isolation, /指纹检查不代替人工语义复核/);
});

test('three-question self-check fails for question one or two yes, or question three no', () => {
  const rule = playbooks.split('\n').find((line) => line.includes('自检三问：'));
  assert.ok(rule);
  assert.match(rule, /失败条件是 \*\*①是或②是或③否\*\*/);
  assert.match(rule, /只有①否、②否、③是才通过/);
  assert.doesNotMatch(rule, /任一为是就改写/);
});

test('image-option teaching examples do not decide slope signs or conformity in advance', () => {
  const section = between(playbooks, '## 5.2 题内嵌选项与图像选项', '## 5.3 作图题');
  assert.match(section, /先由题干关系判断斜率符号.*与 G2 的图线变化方向对照/);
  assert.match(section, /不得提前给出应有的正负斜率/);
  assert.match(section, /仅在独立完整解答区给出逐项判定与理由/);
  assert.doesNotMatch(section, /斜率应为负，图线却向上/);
  assert.match(playbooks, /独立“完整解答”区允许答案、选项判定与完整推导，不豁免前置讲解/);
});

test('eight modules apply to explanation; training replies stay in the current stage', () => {
  const rule8 = skill.split('\n').find((line) => line.startsWith('8. **'));
  const rule11 = skill.split('\n').find((line) => line.startsWith('11. **'));
  assert.match(rule8, /讲解区每题完整八模块/);
  assert.match(rule8, /解题模式的前置讲解/);
  assert.match(rule8, /训练模式每次只输出当前阶段/);
  assert.match(rule11, /独立“完整解答”标题.*允许答案、选项判定与完整推导/);
  assert.match(rule11, /不豁免前置八模块或图的答案隔离/);
  assert.match(modes, /独立标题 `## 完整解答`.*单独占一行/);
  assert.match(modes, /`--solution`.*不代替用户的“解题”请求/);
  assert.match(modes, /不豁免前八模块的完整性或答案隔离/);
  assert.match(modes, /每次回复只输出当前阶段/);
  assert.match(modes, /对汇总训练记录只检查/);
  assert.match(modes, /单次回复不为满足该闸门而补写未到的阶段/);
});

test('example keeps navigation, condition sources and an implicit Q1/B1 goal', () => {
  assert.match(example, /30 秒速览：\n①这题在问什么：.+\n②最关键的触发词：.+\n③最容易踩的坑：/);
  const goals = tableRows(between(example, '\n一、目标分析', '\n二、显性条件表'));
  const goal = goals.find((row) => row[0] === 'Q1');
  assert.ok(goal);
  assert.match(goal[1], /定义域.*B1/);
  assert.match(goal[2], /C1.*H1/);

  const explicit = between(example, '\n二、显性条件表', '\n三、隐含条件表');
  const rows = tableRows(explicit);
  assert.deepEqual(rows[0], ['编号', '来源', '条件原文', '类型', '触发词', '对应知识点/定理', '考纲与教材对应']);
  assert.deepEqual(rows.filter((row) => /^C\d+$/.test(row[0])).map((row) => row[0]), ['C1']);
  assert.deepEqual(rows.filter((row) => /^B\d+$/.test(row[0])).map((row) => row.slice(0, 2)), [['B1', 'Q1']]);
  assert.doesNotMatch(explicit, /\| C\d+ \|[^\n]*\| (?:目标|设问) \|/);

  const hidden = tableRows(between(example, '\n三、隐含条件表', '\n四、大爆炸展开图'));
  assert.deepEqual(hidden[0], ['编号', '隐含条件', '来源', '类型', '触发词', '相关度', '对应知识点', '考纲与教材对应']);
  const h1 = hidden.find((row) => row[0] === 'H1');
  assert.ok(h1);
  assert.match(h1[2], /C1.*lg/);
  assert.equal(h1[4], '“lg”');
  assert.equal(h1[5], '核心');

  const paths = between(example, '\n五、收敛·路径提示', '\n六、陷阱提醒');
  const steps = paths.split('\n').filter((line) => /^\d+\./.test(line));
  assert.ok(steps.length >= 1 && steps.length <= 3);
  assert.deepEqual(steps.map((line) => line.match(/^\d+/)[0]), ['1', '2', '3']);
  assert.ok(steps.every((line) => /^\d+\. (?:写出|用|核对)/.test(line)));
});

test('example reuses the unchanged domain diagram and explains its textbook edition', () => {
  assert.match(spec.nodes.find((node) => node.id === 'ROOT').text, /定义域/);
  assert.match(spec.subtitle, /人教A版必修一/);
  assert.match(example, /本示例改用 `examples\/demo-spec.json` 的同一道定义域题/);
  assert.match(example, /未重新渲染/);
  assert.match(example, /人教A版必修一作教学映射/);
  assert.match(example, /人教B版（2019 课标版）.*必修第二册第四章.*原目录待复核/);
  assert.match(example, /!\[[^\]]+\]\(\.\.\/examples\/demo-bigbang\.png\)/);
  assert.ok(readFileSync(path.join(repoRoot, 'examples/demo-bigbang.png')).length > 0);
  const tree = between(example, '\n四、大爆炸展开图', '\n五、收敛·路径提示');
  for (const node of spec.nodes) {
    assert.match(tree, new RegExp(`\\b${node.id}\\b`), `Missing diagram node ${node.id}`);
  }
  const treeIds = [...tree.matchAll(/\b(?:C|H|B|D|K)\d+\b/g)].map((match) => match[0]);
  assert.deepEqual([...new Set(treeIds)].sort(), spec.nodes.filter((node) => node.id !== 'ROOT').map((node) => node.id).sort());
  assert.doesNotMatch(example, /(?:−∞|[−-]1)[^\n]*∪[^\n]*\+∞/);
});

test('B2019 fourth chapter belongs to volume two, without moving volume-one inequalities', () => {
  const math = between(textbookMap, '## 数学（人教B版）', '## 物理（人教版）');
  const volumeOne = between(math, '### 必修第一册', '### 必修第二册');
  const volumeTwo = between(math, '### 必修第二册', '### 必修第三册');
  assert.match(volumeOne, /第二章 等式与不等式/);
  assert.match(volumeOne, /第三章 函数/);
  assert.doesNotMatch(volumeOne, /第四章|指数函数、对数函数与幂函数/);
  assert.match(volumeTwo, /第四章 指数函数、对数函数与幂函数/);
  assert.match(volumeTwo, /第五章 统计与概率/);
  assert.match(volumeTwo, /第六章 平面向量初步/);
  const quick = tableRows(textbookMap).find((row) => row[0] === '指数、对数、幂函数');
  assert.ok(quick);
  assert.match(quick[1], /2019 课标版.*必修第二册 第四章/);
  assert.match(math, /http:\/\/www\.dzkbw\.com\/books\/rjb\/shuxue\/gzbbx2\//);
  assert.match(math, /https:\/\/m\.zxxk\.com\/soft\/51238240\.html/);
  assert.match(math, /403.*原目录待复核.*不声称已核验官方原页/);
});

test('bundled example passes the structural gate with one implicit answer slot', (t) => {
  const dir = createTempDir(t);
  const output = path.join(dir, 'example.md');
  // Resolve the documented MEDIA placeholder only in a temporary fixture.
  writeFileSync(output, example.replace(/^MEDIA:.*$/m, `MEDIA:${path.join(repoRoot, 'examples/demo-bigbang.png')}`));
  const result = runScript('check_output.mjs', [
    output, '--type', 'solution', '--blanks', '0', '--answer-slots', '1',
    '--q-count', '1', '--require-blank-map', '--require-media', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.answerSlots, 1);
  assert.deepEqual(report.fail, []);
});
