import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createTraining, reduceTraining, validateTraining, MAX_PAYLOAD_BYTES } from '../training_state.mjs';
import { createTempDir, runScript } from './helpers.mjs';

const student = 's_alpha';
const coach = { student_id: student, actor: 'coach' };
const user = { student_id: student, actor: 'user' };
const fresh = (max_hints = 2) => createTraining({ student_id: student, question_id: 'q_original', max_hints });
const attempt = (id, complete = false, missing_types = complete ? [] : ['domain_range']) => ({ id, type: 'ATTEMPT', complete, missing_types });
const hint = (id, condition_type = 'domain_range') => ({ id, type: 'HINT', condition_type });
const transfer = (id, complete = true, hinted = false, transfer_question_id = 'q_transfer') => ({
  id, type: 'TRANSFER_ATTEMPT', transfer_question_id, complete, hinted,
});
const step = (state, event, context = coach) => reduceTraining(state, event, context);
const reveal = (state) => step(step(state, { id: 'request', type: 'REQUEST_REVEAL' }, user), { id: 'revealed', type: 'REVEALED' });
const cli = (state, event = null, args = []) => runScript('training_state.mjs', [
  '--student', student, '--actor', 'coach', ...args,
], { input: JSON.stringify({ state, event }) });

test('first complete attempt skips hints and reveal but cannot skip unhinted transfer', () => {
  const original = fresh();
  let state = step(original, attempt('first', true));
  assert.equal(original.history.length, 0);
  assert.equal(state.phase, 'transfer');
  assert.equal(state.hint_count, 0);
  assert.equal(state.initial_independent, true);
  assert.equal(state.assisted, false);
  assert.equal(state.transfer_passed, false);
  state = step(state, transfer('migration'));
  assert.equal(state.phase, 'complete');
  assert.equal(state.transfer_passed, true);
  assert.equal(validateTraining(state), true);
  assert.throws(() => step(state, attempt('after_complete', true)), /terminal/);
});

test('two single hints alternate with attempts, exhausted incomplete attempt requires reveal', () => {
  let state = step(fresh(), attempt('a1', false, ['domain_range', 'units_direction_precision']));
  assert.equal(state.phase, 'hint');
  assert.throws(() => step(state, hint('wrong', 'chart_reading')), /evaluated as missing/);
  state = step(state, hint('h1'));
  assert.equal(state.phase, 'attempt');
  assert.equal(state.hint_count, 1);
  assert.throws(() => step(state, hint('early_h2')), /hint phase/);
  state = step(state, attempt('a2'));
  state = step(state, hint('h2'));
  assert.equal(state.hint_count, 2);
  assert.equal(state.phase, 'attempt');
  state = step(state, attempt('a3'));
  assert.equal(state.phase, 'reveal');
  assert.throws(() => step(state, hint('h3')), /HINT/);
  state = step(state, { id: 'r', type: 'REVEALED' });
  assert.equal(state.phase, 'transfer');
  assert.equal(state.initial_independent, false);
  assert.equal(state.assisted, false);
  state = step(state, transfer('t1', false));
  assert.equal(state.phase, 'transfer');
  state = step(state, transfer('t2'));
  assert.equal(state.phase, 'complete');
});

for (const budget of [0, 1, 2]) {
  test(`hint budget ${budget} is bounded and does not reset`, () => {
    let state = step(fresh(budget), attempt('a0'));
    for (let i = 0; i < budget; i++) {
      assert.equal(state.phase, 'hint');
      state = step(state, hint(`h${i}`));
      state = step(state, attempt(`a${i + 1}`));
    }
    assert.equal(state.phase, 'reveal');
    assert.equal(state.hint_count, budget);
    assert.equal(validateTraining(state), true);
  });
}

test('complete after a hint is assisted, never independently mastered without transfer', () => {
  let state = step(step(step(fresh(), attempt('a1')), hint('h1')), attempt('a2', true));
  assert.equal(state.phase, 'transfer');
  assert.equal(state.initial_independent, false);
  assert.equal(state.assisted, true);
  assert.equal(state.transfer_passed, false);
  state = step(state, transfer('t1'));
  assert.equal(state.transfer_passed, true);
  assert.equal(state.assisted, true);
});

test('voluntary reveal is user-authorized and never marks mastery', () => {
  assert.throws(() => step(fresh(), { id: 'r', type: 'REQUEST_REVEAL' }), /trusted user/);
  let state = step(fresh(), { id: 'request', type: 'REQUEST_REVEAL' }, user);
  assert.equal(state.phase, 'reveal');
  assert.equal(state.initial_independent, null);
  assert.equal(state.assisted, false);
  assert.equal(state.transfer_passed, false);
  assert.throws(() => step(state, transfer('early')), /transfer phase/);
  assert.throws(() => step(state, { id: 'revealed', type: 'REVEALED' }, user), /trusted coach/);
  state = step(state, { id: 'revealed', type: 'REVEALED' });
  assert.equal(state.phase, 'transfer');
});

test('original and hinted migration can never be counted as successful transfer', () => {
  let state = reveal(fresh());
  assert.throws(() => step(state, transfer('original', true, false, 'q_original')), /different question/);
  assert.throws(() => step(state, transfer('hinted', true, true)), /hinted transfer/);
  state = step(state, transfer('failed_hinted', false, true));
  assert.throws(() => step(state, transfer('launder', true, false)), /hinted transfer/);
  assert.equal(state.phase, 'transfer');
  assert.equal(state.transfer_passed, false);
  state = step(state, transfer('fresh_migration', true, false, 'q_fresh_transfer'));
  assert.equal(state.phase, 'complete');
});

for (const phase of ['attempt', 'hint', 'reveal', 'transfer']) {
  test(`pause preserves ${phase} and counters; only user can resume`, () => {
    let state = fresh();
    if (phase === 'hint') state = step(step(step(state, attempt('a1')), hint('h1')), attempt('a2'));
    if (phase === 'reveal') state = step(state, { id: 'r', type: 'REQUEST_REVEAL' }, user);
    if (phase === 'transfer') state = step(state, attempt('a1', true));
    const before = structuredClone(state);
    state = step(state, { id: 'pause', type: 'PAUSE' }, user);
    assert.equal(state.phase, 'paused');
    assert.equal(state.paused_phase, phase);
    assert.equal(state.hint_count, before.hint_count);
    assert.throws(() => step(state, attempt('blocked')), /paused/);
    assert.throws(() => step(state, { id: 'resume', type: 'RESUME' }), /trusted user/);
    assert.throws(() => step(state, { id: 'again', type: 'PAUSE' }, user), /already paused/);
    state = step(state, { id: 'resume', type: 'RESUME' }, user);
    assert.equal(state.phase, before.phase);
    assert.equal(state.paused_phase, null);
    assert.equal(state.hint_count, before.hint_count);
    assert.equal(validateTraining(state), true);
  });
}

test('stop is terminal even from paused, without resetting progress', () => {
  let state = step(step(step(fresh(), attempt('a1')), hint('h1')), { id: 'p', type: 'PAUSE' }, user);
  state = step(state, { id: 's', type: 'STOP' }, user);
  assert.equal(state.phase, 'stopped');
  assert.equal(state.paused_phase, null);
  assert.equal(state.hint_count, 1);
  assert.throws(() => step(state, { id: 'resume', type: 'RESUME' }, user), /terminal/);
  assert.deepEqual(step(state, { id: 's', type: 'STOP' }, user), state);
});

test('event IDs are semantic idempotency keys, conflicts and cross-actor retries rejected', () => {
  const event = attempt('same', false, ['domain_range', 'chart_reading']);
  const state = step(fresh(), event);
  const reordered = { missing_types: ['chart_reading', 'domain_range'], complete: false, type: 'ATTEMPT', id: 'same' };
  assert.deepEqual(step(state, reordered), state);
  assert.throws(() => step(state, attempt('same', true)), /conflicting duplicate/);
  assert.throws(() => step(state, event, user), /trusted coach/);
  const forged = structuredClone(state);
  forged.history.push(structuredClone(forged.history[0]));
  assert.throws(() => validateTraining(forged), /duplicate history/);
});

test('replay rejects forged phases, mastery, counters, pause state and actor history', () => {
  const state = step(step(fresh(), attempt('a1')), hint('h1'));
  for (const change of [
    { phase: 'complete', transfer_passed: true }, { phase: 'reveal' }, { hint_count: 0 },
    { initial_independent: true }, { assisted: true }, { paused_phase: 'attempt' }, { version: 2 },
  ]) assert.throws(() => validateTraining({ ...state, ...change }));
  const forged = structuredClone(state);
  forged.history[0].actor = 'user';
  assert.throws(() => validateTraining(forged), /trusted coach/);
  forged.history[0].actor = 'coach';
  forged.history[0].event = { id: 'a1', type: 'REVEALED' };
  assert.throws(() => validateTraining(forged), /reveal phase/);
});

test('strict schemas, enums and trusted context prevent self-reported authorization or PII', () => {
  assert.throws(() => step(fresh(), attempt('a1'), { student_id: 's_other', actor: 'coach' }), /does not own/);
  assert.throws(() => step(fresh(), attempt('a1'), { ...coach, authorized: true }), /unknown/);
  for (const field of ['actor', 'student_id', 'authorized', 'answer', 'text', 'notes', 'name', 'school', 'photo']) {
    assert.throws(() => step(fresh(), { ...attempt('a1'), [field]: 'secret' }), /unknown/);
  }
  for (const event of [
    { id: 'bad', type: 'UNKNOWN' }, { id: 'bad', type: '__proto__' },
    { id: 'bad', type: 'HINT', condition_type: 'student raw answer' },
    { id: 'bad', type: 'HINT', condition_type: ['domain_range', 'chart_reading'] },
    attempt('bad', false, []), attempt('bad', true, ['domain_range']),
    attempt('bad', false, ['domain_range', 'domain_range']),
    { id: 'bad', type: 'TRANSFER_ATTEMPT', transfer_question_id: 'q_new', complete: true },
  ]) assert.throws(() => step(fresh(), event));
  for (const id of ['__proto__', '学生姓名', 's_a@example.com', 'Alice', 's_' + 'x'.repeat(62)]) {
    assert.throws(() => createTraining({ student_id: id, question_id: 'q1' }));
  }
  for (const budget of [-1, 3, 1.5, '2']) assert.throws(() => fresh(budget));
  assert.throws(() => validateTraining({ ...fresh(), answer: 'private answer' }), /unknown/);
});

test('non-JSON public callers cannot supply getters or sparse arrays', () => {
  const event = attempt('a1');
  Object.defineProperty(event, 'complete', { get() { throw new Error('should not run getter'); }, enumerable: true });
  assert.throws(() => step(fresh(), event), /data fields only/);
  const bad = fresh();
  bad.history = new Array(1);
  assert.throws(() => validateTraining(bad), /dense array/);
});

test('training CLI creates and reduces current-student JSON only and writes no files', (t) => {
  const directory = createTempDir(t);
  const result = runScript('training_state.mjs', ['--student', student, '--actor', 'coach'], {
    cwd: directory,
    input: JSON.stringify({ state: { student_id: student, question_id: 'q_original' }, event: attempt('a1', true) }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).phase, 'transfer');
  assert.deepEqual(readdirSync(directory), []);
  assert.equal(cli(fresh()).status, 0);
});

test('training CLI refuses impersonation, missing/duplicate flags and JSON data authorization', () => {
  for (const result of [
    cli(createTraining({ student_id: 's_other', question_id: 'q1' })),
    runScript('training_state.mjs', ['--student', student], { input: '{}' }),
    cli(fresh(), null, ['--actor', 'user']),
    cli(fresh(), null, ['--save', '/tmp/not-allowed.json']),
    runScript('training_state.mjs', ['--student', student, '--actor', 'user'], { input: JSON.stringify({ state: fresh(), event: attempt('a1', true) }) }),
    runScript('training_state.mjs', ['--student', student, '--actor', 'coach'], { input: JSON.stringify({ state: fresh(), event: null, context: user }) }),
  ]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('CLI payload bounds and generic errors never echo private input', () => {
  const secret = '姓名学校照片 secret-answer';
  for (const input of [JSON.stringify({ state: fresh(), event: { ...attempt('a1'), text: secret } }), secret, ' '.repeat(MAX_PAYLOAD_BYTES + 1)]) {
    const result = runScript('training_state.mjs', ['--student', student, '--actor', 'coach'], { input });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(secret));
    assert.match(result.stderr, /^training_state: invalid input or unauthorized transition\n$/);
  }
});

test('importing training state and ledger does not launch their CLIs', () => {
  const urls = ['../training_state.mjs', '../blindspot_ledger.mjs'].map((file) => new URL(file, import.meta.url).href);
  const source = urls.map((url) => `await import(${JSON.stringify(url)});`).join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
