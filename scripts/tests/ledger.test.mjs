import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, symlinkSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createLedger, applyLedgerAction, validateLedger } from '../blindspot_ledger.mjs';
import { MAX_PAYLOAD_BYTES } from '../training_state.mjs';
import { createTempDir, runScript } from './helpers.mjs';

const alpha = { student_id: 's_alpha' };
const beta = { student_id: 's_beta' };
const record = (overrides = {}) => ({
  question_id: 'q_alpha', attempt_id: 'a1', condition_type: 'domain_range',
  assessment: 'missed', date: '2026-11-27', ...overrides,
});
const add = (ledger, value = record(), context = alpha) => applyLedgerAction(ledger, { type: 'record', record: value }, context);
const action = (ledger, type, context = alpha) => applyLedgerAction(ledger, { type }, context);
const key = (value = record()) => ({ question_id: value.question_id, attempt_id: value.attempt_id, condition_type: value.condition_type });
const shared = () => add(add(createLedger()).ledger, record({ question_id: 'q_beta_private', assessment: 'independent' }), beta).ledger;
const cli = (ledger, request = { type: 'view' }, args = [], options = {}) => runScript('blindspot_ledger.mjs', ['--student', alpha.student_id, ...args], {
  input: JSON.stringify({ ledger, action: request }), ...options,
});

test('ledger uses array student entries, validates and never mutates host-owned state', () => {
  const empty = createLedger();
  assert.deepEqual(empty, { version: 1, students: [] });
  const result = add(empty);
  assert.deepEqual(empty, { version: 1, students: [] });
  assert.equal(validateLedger(result.ledger), true);
  assert.equal(result.ledger.students[0].student_id, alpha.student_id);
  assert.deepEqual(Object.keys(result.view.records[0]), ['question_id', 'attempt_id', 'condition_type', 'assessment', 'date']);
  result.view.records[0].assessment = 'transfer';
  assert.equal(result.ledger.students[0].records[0].assessment, 'missed');
});

test('identical key/value recording is idempotent; conflicts require explicit correction', () => {
  const first = add(createLedger());
  assert.deepEqual(add(first.ledger), first);
  assert.throws(() => add(first.ledger, record({ assessment: 'assisted' })), /conflicting duplicate.*correct/);
  assert.throws(() => add(first.ledger, record({ date: '2026-11-26' })), /conflicting duplicate/);
  const nextAttempt = add(first.ledger, record({ attempt_id: 'a2', assessment: 'assisted' }));
  assert.equal(nextAttempt.view.records.length, 2);
  assert.equal(nextAttempt.view.statistics[0].missed, 1);
  assert.equal(nextAttempt.view.statistics[0].assisted, 1);
  const otherStudent = add(first.ledger, record(), beta);
  assert.equal(otherStudent.ledger.students.length, 2);
  assert.equal(otherStudent.view.records.length, 1);
});

test('independent, assisted, transfer and missed counts remain separate across questions', () => {
  let ledger = createLedger();
  for (const [i, assessment] of ['independent', 'assisted', 'transfer', 'missed'].entries()) {
    ledger = add(ledger, record({ question_id: `q${i}`, assessment, date: `2026-11-${20 + i}` })).ledger;
  }
  ledger = add(ledger, record({ condition_type: 'chart_reading', assessment: 'missed' })).ledger;
  const view = action(ledger, 'view').view;
  assert.deepEqual(view.statistics[0], {
    condition_type: 'domain_range', independent: 1, assisted: 1, transfer: 1, missed: 1,
    total: 4, last_question_id: 'q3', last_date: '2026-11-23',
  });
  assert.equal(view.statistics[1].condition_type, 'chart_reading');
});

test('correct, delete and clear recompute all statistics while retaining other students', () => {
  let ledger = shared();
  const betaBefore = structuredClone(ledger.students[1]);
  const replacement = record({ assessment: 'transfer', date: '2026-11-26' });
  let result = applyLedgerAction(ledger, { type: 'correct', ...key(), replacement }, alpha);
  assert.equal(result.view.statistics[0].missed, 0);
  assert.equal(result.view.statistics[0].transfer, 1);
  assert.equal(result.view.statistics[0].last_date, '2026-11-26');
  assert.deepEqual(result.ledger.students[1], betaBefore);
  assert.equal(ledger.students[0].records[0].assessment, 'missed');
  assert.deepEqual(applyLedgerAction(result.ledger, { type: 'correct', ...key(), replacement }, alpha), result);
  assert.throws(() => applyLedgerAction(result.ledger, {
    type: 'correct', ...key(), replacement: record({ question_id: 'q_rekey' }),
  }, alpha), /retain the same record key/);
  assert.throws(() => applyLedgerAction(result.ledger, { type: 'correct', ...key(record({ question_id: 'q_beta_private' })), replacement: record({ question_id: 'q_beta_private' }) }, alpha), /current student.*not found/);
  result = applyLedgerAction(result.ledger, { type: 'delete', ...key() }, alpha);
  assert.deepEqual(result.view.records, []);
  assert.deepEqual(result.view.statistics, []);
  assert.deepEqual(result.ledger.students[1], betaBefore);
  assert.deepEqual(applyLedgerAction(result.ledger, { type: 'delete', ...key() }, alpha), result);
  ledger = add(result.ledger).ledger;
  result = action(ledger, 'clear');
  assert.deepEqual(result.view.records, []);
  assert.deepEqual(result.view.statistics, []);
  assert.deepEqual(result.ledger.students[1], betaBefore);
});

test('stop/start are per student; stopped students can view, correct, delete, clear and export', () => {
  const stopped = action(shared(), 'stop');
  assert.equal(stopped.view.stopped, true);
  assert.throws(() => add(stopped.ledger), /recording is stopped/);
  assert.equal(add(stopped.ledger, record({ attempt_id: 'a2' }), beta).view.records.length, 2);
  assert.deepEqual(action(stopped.ledger, 'stop'), stopped);
  for (const type of ['view', 'export', 'clear']) assert.equal(action(stopped.ledger, type).view.stopped, true);
  const corrected = applyLedgerAction(stopped.ledger, { type: 'correct', ...key(), replacement: record({ assessment: 'assisted' }) }, alpha);
  assert.equal(corrected.view.statistics[0].assisted, 1);
  const deleted = applyLedgerAction(corrected.ledger, { type: 'delete', ...key() }, alpha);
  assert.equal(deleted.view.stopped, true);
  const cleared = action(stopped.ledger, 'clear');
  assert.equal(cleared.view.stopped, true);
  assert.throws(() => add(cleared.ledger), /stopped/);
  assert.equal(add(action(cleared.ledger, 'start').ledger).view.records.length, 1);
});

test('view/export/clear do not create absent students; stop persists absence preference', () => {
  for (const type of ['view', 'export', 'clear', 'delete']) {
    const request = type === 'delete' ? { type, ...key() } : { type };
    const result = applyLedgerAction(createLedger(), request, alpha);
    assert.deepEqual(result.ledger, createLedger());
    assert.deepEqual(result.view, { version: 1, stopped: false, records: [], statistics: [] });
  }
  const stopped = action(createLedger(), 'stop');
  assert.throws(() => add(stopped.ledger), /stopped/);
});

test('export is only a deidentified current-student slice and contains no other student IDs', () => {
  const ledger = shared();
  const result = action(ledger, 'export');
  assert.deepEqual(result.view, action(ledger, 'view').view);
  assert.deepEqual(result.ledger, ledger);
  const serialized = JSON.stringify(result.view);
  for (const forbidden of ['s_alpha', 's_beta', 'q_beta_private', 'students', 'student_id']) assert.ok(!serialized.includes(forbidden));
  assert.equal(result.view.records.length, 1);
});

test('strict schemas reject PII, arbitrary text, unknown enums and student targeting', () => {
  for (const field of ['student_id', 'actor', 'name', 'school', 'photo', 'text', 'answer', 'notes', 'authorized']) {
    assert.throws(() => add(createLedger(), { ...record(), [field]: 'private' }), /unknown/);
    assert.throws(() => applyLedgerAction(shared(), { type: 'view', [field]: 's_beta' }, alpha), /unknown/);
  }
  for (const invalid of [
    record({ condition_type: 'raw answer' }), record({ assessment: 'mastered' }),
    record({ date: '2026-02-30' }), record({ date: '2026-13-01' }), record({ date: 'today' }),
    record({ question_id: '题目原话' }), record({ attempt_id: 'student answer has spaces' }),
  ]) assert.throws(() => add(createLedger(), invalid));
  for (const id of ['__proto__', 'constructor', '李同学', 's_user@example.com', 's_']) {
    assert.throws(() => add(createLedger(), record(), { student_id: id }));
  }
  assert.throws(() => applyLedgerAction(createLedger(), { type: '__proto__' }, alpha), /unknown type/);
  assert.throws(() => applyLedgerAction(createLedger(), { type: 'import', data: [] }, alpha), /unknown type/);
  assert.throws(() => applyLedgerAction(shared(), { type: 'view' }, { ...alpha, other_student: 's_beta' }), /unknown/);
  const poisoned = JSON.parse('{"type":"view","__proto__":{"student_id":"s_beta"}}');
  assert.throws(() => applyLedgerAction(shared(), poisoned, alpha), /unknown/);
  assert.equal(Object.prototype.student_id, undefined);
});

test('ledger validation rejects duplicate students/keys, hidden PII and forged caches', () => {
  const ledger = shared();
  for (const mutate of [
    (value) => value.students.push(structuredClone(value.students[0])),
    (value) => value.students[0].records.push(structuredClone(value.students[0].records[0])),
    (value) => { value.students[1].records[0].notes = 'hidden private answer'; },
    (value) => { value.students[0].statistics = { missed: 999 }; },
    (value) => { value.students = {}; },
    (value) => { value.version = 2; },
    (value) => { value.students[0].stopped = 'yes'; },
    (value) => { value.name = 'private'; },
  ]) {
    const invalid = structuredClone(ledger);
    mutate(invalid);
    assert.throws(() => validateLedger(invalid));
  }
});

test('ledger CLI default stdout is current view, pure reads do not land files or persist across processes', (t) => {
  const directory = createTempDir(t);
  const ledger = shared();
  const result = cli(ledger, { type: 'record', record: record({ attempt_id: 'a2' }) }, [], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).records.length, 2);
  assert.ok(!result.stdout.includes('s_beta'));
  assert.ok(!result.stdout.includes('q_beta_private'));
  assert.ok(!result.stdout.includes('students'));
  assert.deepEqual(readdirSync(directory), []);
  assert.equal(JSON.parse(cli(createLedger()).stdout).records.length, 0);
});

test('ledger CLI saves full local ledger only with explicit consent, stdout remains private view', (t) => {
  const directory = createTempDir(t);
  const filename = path.join(directory, 'ledger.json');
  const ledger = shared();
  const refused = cli(ledger, { type: 'view' }, ['--save', filename]);
  assert.notEqual(refused.status, 0);
  assert.equal(refused.stdout, '');
  assert.deepEqual(readdirSync(directory), []);
  const saved = cli(ledger, { type: 'export' }, ['--save', filename, '--consent']);
  assert.equal(saved.status, 0, saved.stderr);
  assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), ledger);
  assert.equal(lstatSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(saved.stdout), action(ledger, 'export').view);
  assert.ok(!saved.stdout.includes('s_beta'));
  assert.deepEqual(readdirSync(directory), ['ledger.json']);
});

test('ledger CLI refuses overwrite by default, permits overwrite only with new consent', (t) => {
  const directory = createTempDir(t);
  const filename = path.join(directory, 'ledger.json');
  const original = 'do not overwrite';
  writeFileSync(filename, original);
  for (const args of [
    ['--save', filename, '--consent'], ['--save', filename, '--overwrite'],
    ['--overwrite'], ['--consent'],
  ]) {
    const result = cli(shared(), { type: 'clear' }, args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(filename, 'utf8'), original);
  }
  const result = cli(shared(), { type: 'clear' }, ['--save', filename, '--overwrite', '--consent']);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(readFileSync(filename, 'utf8'));
  assert.equal(saved.students[0].records.length, 0);
  assert.equal(saved.students[1].records.length, 1);
  assert.deepEqual(readdirSync(directory), ['ledger.json']);
});

test('ledger save refuses symlink destination/parents and non-files without changing targets', (t) => {
  const directory = createTempDir(t);
  const target = path.join(directory, 'original.json');
  const symlink = path.join(directory, 'ledger-link.json');
  writeFileSync(target, 'secret-existing-content');
  symlinkSync(target, symlink);
  const realDirectory = path.join(directory, 'real');
  mkdirSync(realDirectory);
  const linkedDirectory = path.join(directory, 'linked');
  symlinkSync(realDirectory, linkedDirectory);
  for (const filename of [symlink, path.join(linkedDirectory, 'ledger.json'), realDirectory]) {
    const result = cli(shared(), { type: 'view' }, ['--save', filename, '--consent', '--overwrite']);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
  assert.equal(readFileSync(target, 'utf8'), 'secret-existing-content');
  assert.equal(lstatSync(symlink).isSymbolicLink(), true);
  assert.deepEqual(readdirSync(realDirectory), []);
  assert.ok(!readdirSync(directory).some((name) => name.endsWith('.tmp')));
});

test('CLI stop/correct/delete/start/clear/export all execute actual current-student actions', () => {
  const ledger = shared();
  const cases = [
    [{ type: 'stop' }, (view) => assert.equal(view.stopped, true)],
    [{ type: 'start' }, (view) => assert.equal(view.stopped, false)],
    [{ type: 'correct', ...key(), replacement: record({ assessment: 'transfer' }) }, (view) => assert.equal(view.statistics[0].transfer, 1)],
    [{ type: 'delete', ...key() }, (view) => assert.equal(view.records.length, 0)],
    [{ type: 'clear' }, (view) => assert.equal(view.records.length, 0)],
    [{ type: 'export' }, (view) => assert.equal(view.records.length, 1)],
  ];
  for (const [request, check] of cases) {
    const result = cli(ledger, request);
    assert.equal(result.status, 0, result.stderr);
    check(JSON.parse(result.stdout));
    assert.ok(!result.stdout.includes('s_beta'));
    assert.ok(!result.stdout.includes('q_beta_private'));
  }
});

test('CLI rejects flags, stdin authorization, hidden PII and oversize without echoing input', () => {
  const privateText = '姓名学校照片 raw-secret-answer';
  const invalidLedger = shared();
  invalidLedger.students[1].records[0].notes = privateText;
  const inputs = [
    JSON.stringify({ ledger: invalidLedger, action: { type: 'view' } }),
    JSON.stringify({ ledger: shared(), action: { type: 'view' }, context: beta }),
    JSON.stringify({ ledger: shared(), action: { type: 'view', student_id: beta.student_id } }),
    ' '.repeat(MAX_PAYLOAD_BYTES + 1), privateText,
  ];
  for (const input of inputs) {
    const result = runScript('blindspot_ledger.mjs', ['--student', alpha.student_id], { input });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(privateText));
    assert.match(result.stderr, /^blindspot_ledger: invalid input, unauthorized action or refused local save\n$/);
  }
  for (const args of [[], ['--student', '__proto__'], ['--student', alpha.student_id, '--student', beta.student_id], ['--student', alpha.student_id, '--network']]) {
    const result = runScript('blindspot_ledger.mjs', args, { input: JSON.stringify({ ledger: shared(), action: { type: 'view' } }) });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});
