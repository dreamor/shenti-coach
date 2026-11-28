#!/usr/bin/env node
// Local-only anonymous ledger. Pure functions never store or transmit anything.
import { lstat, open, link, rename, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CONDITION_TYPES, MAX_PAYLOAD_BYTES, assertFields, assertArray, assertId,
  assertStudentId, assertConditionType, readJsonInput,
} from './training_state.mjs';

const MAX_STUDENTS = 256;
const MAX_RECORDS = 4096;
const ASSESSMENTS = ['independent', 'assisted', 'transfer', 'missed'];
const RECORD_FIELDS = ['question_id', 'attempt_id', 'condition_type', 'assessment', 'date'];
const KEY_FIELDS = ['question_id', 'attempt_id', 'condition_type'];
const ACTION_FIELDS = Object.freeze({
  record: ['type', 'record'], view: ['type'], export: ['type'],
  correct: ['type', ...KEY_FIELDS, 'replacement'], delete: ['type', ...KEY_FIELDS],
  stop: ['type'], start: ['type'], clear: ['type'],
});

function validateKey(value) {
  assertId(value.question_id, 'question_id');
  assertId(value.attempt_id, 'attempt_id');
  assertConditionType(value.condition_type);
}

function normalizeRecord(record) {
  assertFields(record, RECORD_FIELDS, 'record');
  validateKey(record);
  if (!ASSESSMENTS.includes(record.assessment)) throw new Error('assessment: unknown enum');
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)
      || !Number.isFinite(Date.parse(`${record.date}T00:00:00.000Z`))
      || new Date(`${record.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== record.date) {
    throw new Error('date: expected a real YYYY-MM-DD date');
  }
  return {
    question_id: record.question_id, attempt_id: record.attempt_id,
    condition_type: record.condition_type, assessment: record.assessment, date: record.date,
  };
}

function recordKey(record) {
  return JSON.stringify([record.question_id, record.attempt_id, record.condition_type]);
}

function copyRecord(record) {
  return {
    question_id: record.question_id, attempt_id: record.attempt_id,
    condition_type: record.condition_type, assessment: record.assessment, date: record.date,
  };
}

export function createLedger() {
  return { version: 1, students: [] };
}

function normalizeLedger(ledger) {
  assertFields(ledger, ['version', 'students'], 'ledger');
  if (ledger.version !== 1) throw new Error('ledger: unsupported version');
  assertArray(ledger.students, MAX_STUDENTS, 'students');
  const result = createLedger();
  const students = new Set();
  let recordCount = 0;
  for (const student of ledger.students) {
    assertFields(student, ['student_id', 'stopped', 'records'], 'student entry');
    assertStudentId(student.student_id);
    if (students.has(student.student_id)) throw new Error('ledger: duplicate student');
    students.add(student.student_id);
    if (typeof student.stopped !== 'boolean') throw new Error('stopped: expected boolean');
    assertArray(student.records, MAX_RECORDS, 'records');
    recordCount += student.records.length;
    if (recordCount > MAX_RECORDS) throw new Error('ledger: record limit exceeded');
    const keys = new Set();
    const records = student.records.map((item) => {
      const record = normalizeRecord(item);
      const key = recordKey(record);
      if (keys.has(key)) throw new Error('ledger: duplicate record key');
      keys.add(key);
      return record;
    });
    result.students.push({ student_id: student.student_id, stopped: student.stopped, records });
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('ledger: payload limit exceeded');
  return result;
}

export function validateLedger(ledger) {
  normalizeLedger(ledger);
  return true;
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('action: expected object');
  const descriptor = Object.getOwnPropertyDescriptor(action, 'type');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || !Object.hasOwn(ACTION_FIELDS, descriptor.value)) throw new Error('action: unknown type');
  const type = descriptor.value;
  assertFields(action, ACTION_FIELDS[type], 'action');
  const result = { type };
  if (type === 'record') result.record = normalizeRecord(action.record);
  if (['correct', 'delete'].includes(type)) {
    validateKey(action);
    result.question_id = action.question_id;
    result.attempt_id = action.attempt_id;
    result.condition_type = action.condition_type;
    if (type === 'correct') {
      result.replacement = normalizeRecord(action.replacement);
      if (recordKey(result.replacement) !== recordKey(result)) {
        throw new Error('correct: replacement must retain the same record key');
      }
    }
  }
  return result;
}

function studentView(student) {
  // Even export excludes ALL student IDs. Statistics are always recomputed, never cached.
  const records = student ? student.records.map(copyRecord) : [];
  const statistics = CONDITION_TYPES.flatMap((conditionType) => {
    const matching = records.filter((record) => record.condition_type === conditionType);
    if (!matching.length) return [];
    const latest = matching.reduce((previous, record) => record.date >= previous.date ? record : previous);
    return [{
      condition_type: conditionType,
      independent: matching.filter((record) => record.assessment === 'independent').length,
      assisted: matching.filter((record) => record.assessment === 'assisted').length,
      transfer: matching.filter((record) => record.assessment === 'transfer').length,
      missed: matching.filter((record) => record.assessment === 'missed').length,
      total: matching.length, last_question_id: latest.question_id, last_date: latest.date,
    }];
  });
  return { version: 1, stopped: student?.stopped ?? false, records, statistics };
}

export function applyLedgerAction(ledger, action, context) {
  assertFields(context, ['student_id'], 'context');
  assertStudentId(context.student_id);
  const result = normalizeLedger(ledger);
  const request = normalizeAction(action);
  let student = result.students.find((entry) => entry.student_id === context.student_id);
  if (['record', 'stop', 'start'].includes(request.type) && !student) {
    if (result.students.length >= MAX_STUDENTS) throw new Error('ledger: student limit exceeded');
    student = { student_id: context.student_id, stopped: false, records: [] };
    result.students.push(student);
  }
  if (request.type === 'record') {
    if (student.stopped) throw new Error('recording is stopped for this student');
    const previous = student.records.find((record) => recordKey(record) === recordKey(request.record));
    if (previous && JSON.stringify(previous) !== JSON.stringify(request.record)) {
      throw new Error('record: conflicting duplicate; use correct');
    }
    if (!previous) student.records.push(request.record);
  } else if (request.type === 'correct') {
    const index = student?.records.findIndex((record) => recordKey(record) === recordKey(request)) ?? -1;
    if (index < 0) throw new Error('correct: current student record not found');
    student.records[index] = request.replacement;
  } else if (request.type === 'delete') {
    if (student) student.records = student.records.filter((record) => recordKey(record) !== recordKey(request));
  } else if (request.type === 'clear') {
    if (student) student.records = []; // Preserve stop preference; never remove shared file/students.
  } else if (request.type === 'stop') {
    student.stopped = true;
  } else if (request.type === 'start') {
    student.stopped = false;
  }
  validateLedger(result); // Also enforce aggregate limits after append.
  return { ledger: result, view: studentView(student) };
}

async function optionalStat(filename) {
  try { return await lstat(filename); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertSafeDirectory(directory) {
  // Refuse symlinked ancestors as well as a symlink destination.
  let cursor = directory;
  while (true) {
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('save: parent is not a real directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function saveLedger(filename, ledger, overwrite) {
  const destination = path.resolve(filename);
  const directory = path.dirname(destination);
  await assertSafeDirectory(directory);
  const existing = await optionalStat(destination);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error('save: unsafe destination');
  if (existing && !overwrite) throw new Error('save: destination exists; overwrite requires explicit consent');
  const temporary = path.join(directory, `.blindspot-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(ledger)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await assertSafeDirectory(directory);
    const current = await optionalStat(destination);
    if (current && (current.isSymbolicLink() || !current.isFile())) throw new Error('save: unsafe destination');
    if (existing && (!current || current.dev !== existing.dev || current.ino !== existing.ino)) {
      throw new Error('save: destination changed during write');
    }
    if (existing) {
      await rename(temporary, destination); // Replace a checked regular file, never follow its contents.
    } else {
      // Atomic no-clobber creation, even if another writer creates the destination now.
      await link(temporary, destination);
      await unlink(temporary);
    }
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--student', '--save', '--consent', '--overwrite'].includes(flag) || flags.has(flag)) {
      throw new Error('usage: blindspot_ledger.mjs --student s_ID [--save file --consent [--overwrite]]');
    }
    if (['--consent', '--overwrite'].includes(flag)) flags.set(flag, true);
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('flag requires a value');
      flags.set(flag, value);
    }
  }
  const context = { student_id: flags.get('--student') };
  assertStudentId(context.student_id);
  if ((flags.has('--save') && !flags.has('--consent'))
      || ((flags.has('--consent') || flags.has('--overwrite')) && !flags.has('--save'))) {
    throw new Error('save/overwrite requires --save and --consent');
  }
  const input = await readJsonInput();
  assertFields(input, ['ledger', 'action'], 'stdin');
  const result = applyLedgerAction(input.ledger, input.action, context);
  if (flags.has('--save')) await saveLedger(flags.get('--save'), result.ledger, flags.has('--overwrite'));
  // Never print the shared ledger, even when explicitly saving it locally.
  process.stdout.write(`${JSON.stringify(result.view)}\n`);
}

// Node resolves the main module through symlinks while process.argv keeps the
// invoked path (macOS /tmp -> /private/tmp, /var -> /private/var, or an
// installed skill directory behind a link). A raw compare silently skipped
// main() and exited 0, so compare both realpaths instead.
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (invokedAsMain()) {
  main().catch(() => {
    process.stderr.write('blindspot_ledger: invalid input, unauthorized action or refused local save\n');
    process.exitCode = 1;
  });
}
