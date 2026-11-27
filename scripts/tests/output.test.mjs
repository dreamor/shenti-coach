import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTempDir, runScript } from './helpers.mjs';

const explain = `## 〇、题目复述与题型识别
数学，题型：解答题。
30 秒速览：求函数的定义域；关键触发词是 lg；留意定义条件。

## 一、目标分析
| 小问 | 问什么 | 从哪类条件入手 |
| --- | --- | --- |
| Q1 | 求函数的定义域区间 | 由 C1 与 H1 入手 |

## 二、显性条件表
| 编号 | 来源 | 条件原文 | 类型 | 触发词 | 对应知识点 | 考纲与教材对应 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 题干 | 已知函数 f(x)=lg(x) | 函数条件 | lg | 对数函数 | 课标要求：理解定义域；教材：必修第四章 |

| B 编号 | 小问 | 待填类型 | 判断依据 |
| --- | --- | --- | --- |
| B1 | Q1 | 区间 | 由 C1 与 H1 判断 |

## 三、隐含条件表
| 编号 | 隐含条件 | 来源 | 触发词 | 相关度 | 考纲与教材对应 |
| --- | --- | --- | --- | --- | --- |
| H1 | 对数真数满足定义条件 | 由 C1 触发 | lg | 核心 | 必修对数函数 |

## 四、大爆炸展开图
题目 → C1 → H1 → B1
MEDIA:/tmp/shenti-example.png

## 五、收敛·路径提示
先检查定义域，再整理关系。

## 六、陷阱提醒
留意真数的约束。

## 七、审题收获
看到对数先检查定义条件。
`;

const training = `第1步 学生先拆条件
学生：已识别函数条件。
第2步 分步提示
本轮只给1条触发词提示
> 对数的定义对真数有什么约束？
请再想一轮。
第3步 揭示条件与路径
H1：对数真数满足定义条件。
MEDIA:/tmp/shenti-training.png
第4步 盲区账本
| 日期 | 条件类型 | 累计次数 |
| --- | --- | --- |
| 2026-11-27 | 定义条件 | 一次 |
`;

function check(t, text, args = []) {
  const dir = createTempDir(t);
  const file = path.join(dir, 'output.md');
  writeFileSync(file, text);
  const result = runScript('check_output.mjs', [file, '--type', 'solution', '--json', ...args], { cwd: dir });
  return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

test('合法八模块通过，缺模块和作答点被拒绝', t => {
  assert.equal(check(t, explain, ['--answer-slots', '1']).status, 0);
  assert.equal(check(t, explain.replace('## 三、隐含条件表', '隐含条件表')).status, 1);
  const missingB = check(t, explain.replaceAll('B1', '作答卡'), ['--answer-slots', '1']);
  assert.equal(missingB.status, 1);
  assert.ok(missingB.report.fail.some(line => line.includes('一空一 B')));
});

test('--solution 不能豁免完整解答标题之前的答案', t => {
  const leaked = explain.replace('先检查定义域，再整理关系。', '所求数值：271828。');
  for (const suffix of ['', '\n## 完整解答\n所求数值：271828。\n']) {
    const result = check(t, leaked + suffix, ['--solution', '--strict-answer', '--answer', '271828']);
    assert.equal(result.status, 1);
    assert.ok(result.report.answerLeaks.some(leak => leak.section === '五'));
  }
});

test('审题收获不能成为最终答案的豁免区', t => {
  const result = check(t, explain.replace('看到对数先检查定义条件。', '所求数值为271828。'), [
    '--strict-answer', '--answer', '271828',
  ]);
  assert.equal(result.status, 1);
  assert.ok(result.report.answerLeaks.some(leak => leak.section === '七'));
});

test('--solution 仅允许完整解答区内的答案', t => {
  const result = check(t, explain + '\n## 完整解答\n所求数值：271828。\n', [
    '--solution', '--strict-answer', '--answer', '271828',
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.report.answerLeaks, []);
});

test('数字指纹不误报结构编号，仍识别同一行真实数值', t => {
  const clean = check(t, explain, ['--strict-answer', '--answer', '1']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.deepEqual(clean.report.answerLeaks, []);
  const leaked = check(t, explain.replace('| B1 | Q1 | 区间 |', '| B1 | Q1 | 所求数值为1 |'), [
    '--strict-answer', '--answer', '1',
  ]);
  assert.equal(leaked.status, 1);
  assert.ok(leaked.report.answerLeaks.some(leak => leak.context.includes('数值为1')));
});

test('数字指纹不匹配其他数值内部，支持负数与小数', t => {
  const otherValues = explain.replace('先检查定义域，再整理关系。', '先核对题面参数10、0.1与-1，再整理关系。');
  assert.equal(check(t, otherValues, ['--strict-answer', '--answer', '1']).status, 0);
  for (const answer of ['-1', '0.5']) {
    const leaked = explain.replace('先检查定义域，再整理关系。', `所求数值为${answer}。`);
    assert.equal(check(t, leaked, ['--strict-answer', '--answer', answer]).status, 1);
  }
});

test('极大合法计数只报告有限个缺失编号，不分配巨型数组', t => {
  for (const flag of ['--answer-slots', '--q-count']) {
    const result = check(t, explain, [flag, String(Number.MAX_SAFE_INTEGER)]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

for (const flag of ['--blanks', '--answer-slots', '--q-count']) {
  test(`${flag} 拒绝非法计数并接受零`, t => {
    for (const value of ['abc', '-1', '1.5', 'Infinity', '9007199254740992', '']) {
      const result = check(t, explain, [flag, value]);
      assert.equal(result.status, 2, `${flag} ${value}: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /整数|参数|不能为空/);
    }
    assert.equal(check(t, explain, [flag, '0']).status, 0);
  });
}

test('缺失参数值不能吞掉下一个 flag，负数答案仍有效', t => {
  for (const args of [['--answer'], ['--answer', '--strict-answer'], ['--blanks', '--json'], ['--mode']]) {
    const result = check(t, explain, args);
    assert.equal(result.status, 2, result.stdout + result.stderr);
  }
  assert.equal(check(t, explain, ['--strict-answer', '--answer', '-1']).status, 0);
});

test('严格答案检查在讲解及训练模式都要求非空指纹', t => {
  assert.equal(check(t, explain, ['--strict-answer']).status, 2);
  assert.equal(check(t, training, ['--mode', 'training', '--strict-answer']).status, 2);
});

test('训练四步通过，提前出图、多条提示和答案被拒绝', t => {
  const args = ['--mode', 'training', '--strict-answer', '--answer', '271828'];
  assert.equal(check(t, training, args).status, 0);
  assert.equal(check(t, `MEDIA:/tmp/early.png\n${training}`, args).status, 1);
  assert.equal(check(t, training.replace('请再想一轮。', '> 再核对另一个条件。\n请再想一轮。'), args).status, 1);
  assert.equal(check(t, training.replace('H1：', '所求数值：271828。\nH1：'), args).status, 1);
});

test('训练模式不能借 --solution 或解答标题绕过答案隔离', t => {
  const text = training.replace('H1：', '## 完整解答\n所求数值：271828。\nH1：');
  assert.equal(check(t, text, ['--mode', 'training', '--solution', '--strict-answer', '--answer', '271828']).status, 1);
});

test('多题文档的完整解答豁免在任意层级的下一题八模块开始时结束', t => {
  const first = explain + '\n## 完整解答\n所求数值为271828。\n';
  for (const level of [2, 4, 6]) {
    const second = explain.replace('先检查定义域，再整理关系。', '所求数值为271828。')
      .replaceAll('## ', '#'.repeat(level) + ' ');
    const result = check(t, first + second, ['--solution', '--strict-answer', '--answer', '271828']);
    assert.equal(result.status, 1, `标题层级 ${level}`);
    assert.ok(result.report.answerLeaks.some(leak => leak.section === '五'));
  }
});

test('教材元数据不能遮蔽同格内的知识内容或答案', t => {
  const text = explain.replace('教材：必修第四章', '教材：必修第四章；内容：所求数值为271828');
  assert.equal(check(t, text, ['--strict-answer', '--answer', '271828']).status, 1);
});

test('句末英文句点不把真实数字答案变成小数片段', t => {
  const text = explain.replace('先检查定义域，再整理关系。', '所求数值为1.');
  assert.equal(check(t, text, ['--strict-answer', '--answer', '1']).status, 1);
});

test('只遮蔽图片路径，图片说明和同一行答案仍要扫描', t => {
  const args = ['--strict-answer', '--answer', '271828'];
  const clean = explain.replace('MEDIA:/tmp/shenti-example.png', '![审题图](/tmp/271828.png)');
  assert.equal(check(t, clean, args).status, 0);
  for (const image of [
    '![审题图](/tmp/diagram.png) 所求数值为271828。',
    '![所求数值为271828](/tmp/diagram.png)',
    'MEDIA:/tmp/diagram.png 所求数值为271828。',
  ]) {
    assert.equal(check(t, explain.replace('MEDIA:/tmp/shenti-example.png', image), args).status, 1);
  }
});

test('训练模式严格语义复核也要求人工复核声明', t => {
  const args = ['--mode', 'training', '--answer', '271828', '--strict-semantic'];
  assert.equal(check(t, training, args).status, 1);
  assert.equal(check(t, training, [...args, '--semantic-reviewed']).status, 0);
});
