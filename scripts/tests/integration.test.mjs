import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTraining, reduceTraining } from '../training_state.mjs';
import { createLedger, applyLedgerAction } from '../blindspot_ledger.mjs';
import { resolveDelivery } from '../lib/delivery.mjs';
import { createTempDir, repoRoot, runScript } from './helpers.mjs';

const audit = readFileSync(path.join(repoRoot, 'references/example.md'), 'utf8');
const learner = '## 30 秒速览\n识别题目目标。\n## 核心条件\nC1 → H1。\n## 路径\n先检查定义条件，再整理关系。\n## 迁移规则\n见对数先检查定义条件。\n';
const user = { student_id: 's_demo', actor: 'user' };
const coach = { student_id: 's_demo', actor: 'coach' };

function fixture(t, filename = '审题 图.png') {
  const dir = createTempDir(t);
  const png = path.join(dir, filename);
  copyFileSync(path.join(repoRoot, 'examples/demo-bigbang.png'), png);
  const manifest = resolveDelivery({ requested: 'file', renderResult: { ok: true, status: 'ok', output: png }, expectedPath: png });
  const manifestFile = path.join(dir, 'delivery.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  return { dir, png, manifest, manifestFile };
}

function check(t, text, state, args = []) {
  const dir = createTempDir(t);
  const file = path.join(dir, 'turn.md');
  const stateFile = path.join(dir, 'state.json');
  writeFileSync(file, text);
  writeFileSync(stateFile, JSON.stringify(state));
  const result = runScript('check_output.mjs', [file, '--mode', 'training', '--training-state', stateFile,
    '--student', 's_demo', '--question', 'q_original', '--strict-answer', '--answer', '271828', '--json', ...args]);
  return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

test('自适应初始回复无需凑四步，隐藏条件/路径/附件不能提前交付', t => {
  const state = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  assert.equal(check(t, '请先列出目标和显性条件。', state).status, 0);
  for (const text of ['H1：真数满足定义条件。', '路径提示：先检查定义域。', 'MEDIA:/tmp/chart.png', '[查看审计](audit.md)']) {
    assert.equal(check(t, text, state).status, 1, text);
  }
});

test('提示每轮一条，迁移不能带提示，掌握要有真实历史', t => {
  let state = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  state = reduceTraining(state, { id: 'a1', type: 'ATTEMPT', complete: false, missing_types: ['domain_range'] }, coach);
  assert.equal(check(t, '> 见到 lg 应检查什么定义要求？', state).status, 0);
  assert.equal(check(t, '> 请检查定义。\n> 也检查单位。', state).status, 1);
  let complete = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  complete = reduceTraining(complete, { id: 'a2', type: 'ATTEMPT', complete: true, missing_types: [] }, coach);
  assert.equal(check(t, '提示：先检查定义。', complete).status, 1);
  complete = reduceTraining(complete, { id: 't1', type: 'TRANSFER_ATTEMPT', transfer_question_id: 'q_transfer', complete: true, hinted: false }, coach);
  assert.equal(check(t, '已通过无提示迁移。', complete).status, 0);
  const forged = { ...createTraining({ student_id: 's_demo', question_id: 'q_original' }), phase: 'complete', transfer_passed: true };
  assert.equal(check(t, '已掌握。', forged).status, 2);
});

test('状态与学生/题次一致，训练不能绕过答案隔离', t => {
  const state = createTraining({ student_id: 's_other', question_id: 'q_original' });
  assert.equal(check(t, '请拆题。', state).status, 2);
  const wrongQuestion = createTraining({ student_id: 's_demo', question_id: 'q_other' });
  assert.equal(check(t, '请拆题。', wrongQuestion).status, 2);
  const proper = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  assert.equal(check(t, '所求数值为271828。', proper, ['--solution']).status, 1);
});

test('揭示阶段允许真实文件交付而非强制 MEDIA', t => {
  const { png, manifestFile } = fixture(t);
  let state = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  state = reduceTraining(state, { id: 'r1', type: 'REQUEST_REVEAL' }, user);
  assert.equal(check(t, `H1：定义条件。\n图片仅保存在本地：${png}`, state,
    ['--delivery', 'file', '--delivery-manifest', manifestFile]).status, 0);
});

test('迁移拒绝未标注的引用提示，强制生图不能空跑', t => {
  let state = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  state = reduceTraining(state, { id: 'a1', type: 'ATTEMPT', complete: true, missing_types: [] }, coach);
  assert.equal(check(t, '> 见到 lg 应检查什么定义要求？', state).status, 1);
  let reveal = createTraining({ student_id: 's_demo', question_id: 'q_original' });
  reveal = reduceTraining(reveal, { id: 'r1', type: 'REQUEST_REVEAL' }, user);
  assert.notEqual(check(t, 'H1：定义条件。', reveal, ['--require-media']).status, 0);
  const { manifestFile } = fixture(t);
  assert.equal(check(t, 'H1：定义条件。', reveal,
    ['--require-media', '--delivery', 'file', '--delivery-manifest', manifestFile]).status, 1);
});

test('同一完整题次重复提示不累计，完成状态显式更正而非加记录', () => {
  const context = { student_id: 's_demo' };
  const record = { question_id: 'q_original', attempt_id: 'run1', condition_type: 'domain_range', assessment: 'missed', date: '2026-11-27' };
  const first = applyLedgerAction(createLedger(), { type: 'record', record }, context);
  const repeated = applyLedgerAction(first.ledger, { type: 'record', record }, context);
  assert.equal(repeated.view.records.length, 1);
  const updated = applyLedgerAction(repeated.ledger, { type: 'correct', question_id: record.question_id,
    attempt_id: record.attempt_id, condition_type: record.condition_type, replacement: { ...record, assessment: 'assisted' } }, context);
  assert.equal(updated.view.records.length, 1);
  assert.equal(updated.view.records[0].assessment, 'assisted');
});

test('文件名中的指纹不误报，精确路径外的同行答案仍被拒绝', t => {
  const { dir, png, manifestFile } = fixture(t, '271828.png');
  const auditFile = path.join(dir, 'audit.md');
  const learnerFile = path.join(dir, 'learner.md');
  writeFileSync(auditFile, audit);
  const args = [auditFile, '--type', 'solution', '--presentation', learnerFile, '--delivery', 'file',
    '--delivery-manifest', manifestFile, '--strict-answer', '--answer', '271828', '--json'];
  writeFileSync(learnerFile, `${learner}\n本地文件：\`${png}\`\n`);
  assert.equal(runScript('check_output.mjs', args).status, 0);
  writeFileSync(learnerFile, `${learner}\n本地文件：\`${png}\`，所求数值为271828。\n`);
  assert.equal(runScript('check_output.mjs', args).status, 1);
});

test('学生页多行数学必须闭合，不能借展示预算截掉结束符', t => {
  const { dir, png, manifestFile } = fixture(t);
  const auditFile = path.join(dir, 'audit.md');
  const learnerFile = path.join(dir, 'learner.md');
  writeFileSync(auditFile, audit);
  const args = [auditFile, '--type', 'solution', '--presentation', learnerFile, '--delivery', 'file',
    '--delivery-manifest', manifestFile, '--strict-answer', '--answer', '271828', '--json'];
  const template = learner.replace('先检查定义条件，再整理关系。', () => '先检查以下约束：\n$$\nx>0\n$$');
  writeFileSync(learnerFile, `${template}\n${png}`);
  assert.equal(runScript('check_output.mjs', args).status, 0);
  writeFileSync(learnerFile, `${template.replace('x>0\n$$', 'x>0')}\n${png}`);
  assert.equal(runScript('check_output.mjs', args).status, 1);
});

test('完整审计与简洁学生页配对检查，泄题或重复整页均被拒绝', t => {
  const { dir, png, manifestFile } = fixture(t);
  const auditFile = path.join(dir, 'audit.md');
  const learnerFile = path.join(dir, 'learner.md');
  writeFileSync(auditFile, audit);
  const args = [auditFile, '--type', 'solution', '--presentation', learnerFile, '--delivery', 'file',
    '--delivery-manifest', manifestFile, '--strict-answer', '--answer', '271828', '--json'];
  writeFileSync(learnerFile, `${learner}\n本地图片：${png}\n`);
  assert.equal(runScript('check_output.mjs', args).status, 0);
  writeFileSync(learnerFile, `${learner}\n所求数值为271828。\n${png}`);
  assert.equal(runScript('check_output.mjs', args).status, 1);
  writeFileSync(learnerFile, audit);
  assert.equal(runScript('check_output.mjs', args).status, 1);
  writeFileSync(learnerFile, '');
  assert.equal(runScript('check_output.mjs', args).status, 1);
});
