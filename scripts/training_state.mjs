#!/usr/bin/env node
// Pure, replay-validated training state. Only a trusted host supplies student/actor.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONDITION_TYPES = Object.freeze([
  'domain_range', 'figure_property', 'quantifier', 'term_definition',
  'derived_lemma', 'target_misread', 'units_direction_precision', 'chart_reading',
  'experiment_control', 'blank_type', 'subquestion_dependency', 'missing_information',
]);
export const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_HISTORY = 512;
const PHASES = ['attempt', 'hint', 'reveal', 'transfer', 'complete', 'paused', 'stopped'];
const USER_EVENTS = ['REQUEST_REVEAL', 'PAUSE', 'RESUME', 'STOP'];
const EVENT_FIELDS = Object.freeze({
  ATTEMPT: ['id', 'type', 'complete', 'missing_types'],
  HINT: ['id', 'type', 'condition_type'],
  REQUEST_REVEAL: ['id', 'type'],
  REVEALED: ['id', 'type'],
  TRANSFER_ATTEMPT: ['id', 'type', 'transfer_question_id', 'complete', 'hinted'],
  PAUSE: ['id', 'type'], RESUME: ['id', 'type'], STOP: ['id', 'type'],
});
const STATE_FIELDS = [
  'version', 'student_id', 'question_id', 'phase', 'paused_phase', 'hint_count',
  'max_hints', 'initial_independent', 'assisted', 'transfer_passed', 'history',
];

export function assertFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label}: expected a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new Error(`${label}: unknown or missing fields`);
  }
  if (keys.some((key) => !Object.getOwnPropertyDescriptor(value, key).enumerable
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    throw new Error(`${label}: data fields only`);
  }
}

export function assertId(value, label = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    throw new Error(`${label}: expected a bounded opaque ASCII id`);
  }
}

export function assertStudentId(value) {
  if (typeof value !== 'string' || !/^s_[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/.test(value)) {
    throw new Error('student_id: expected an anonymous s_ id (no names, email or school)');
  }
}

export function assertConditionType(value) {
  if (!CONDITION_TYPES.includes(value)) throw new Error('condition_type: unknown enum');
}

export function assertArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum
      || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${label}: expected a bounded dense array`);
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label}: expected data elements`);
    }
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label}: expected boolean`);
}

function validateContext(context) {
  assertFields(context, ['student_id', 'actor'], 'context');
  assertStudentId(context.student_id);
  if (!['user', 'coach'].includes(context.actor)) throw new Error('actor: expected user or coach');
}

function normalizeEvent(event) {
  // Inspect descriptors before looking at type, including for non-JSON callers.
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event: expected object');
  const descriptor = Object.getOwnPropertyDescriptor(event, 'type');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || !Object.hasOwn(EVENT_FIELDS, descriptor.value)) throw new Error('event: unknown type');
  const type = descriptor.value;
  assertFields(event, EVENT_FIELDS[type], 'event');
  assertId(event.id, 'event.id');
  const result = { id: event.id, type };
  if (type === 'ATTEMPT') {
    assertBoolean(event.complete, 'complete');
    assertArray(event.missing_types, CONDITION_TYPES.length, 'missing_types');
    event.missing_types.forEach(assertConditionType);
    if (new Set(event.missing_types).size !== event.missing_types.length
        || event.complete !== (event.missing_types.length === 0)) {
      throw new Error('ATTEMPT: complete must agree with unique missing_types');
    }
    result.complete = event.complete;
    result.missing_types = [...event.missing_types].sort();
  } else if (type === 'HINT') {
    assertConditionType(event.condition_type);
    result.condition_type = event.condition_type;
  } else if (type === 'TRANSFER_ATTEMPT') {
    assertId(event.transfer_question_id, 'transfer_question_id');
    assertBoolean(event.complete, 'complete');
    assertBoolean(event.hinted, 'hinted');
    result.transfer_question_id = event.transfer_question_id;
    result.complete = event.complete;
    result.hinted = event.hinted;
  }
  return result;
}

export function createTraining(options) {
  // The sole optional creation parameter is max_hints; no arbitrary data merge.
  if (!options || typeof options !== 'object') throw new Error('training options: expected object');
  const fields = Object.hasOwn(options, 'max_hints')
    ? ['student_id', 'question_id', 'max_hints'] : ['student_id', 'question_id'];
  assertFields(options, fields, 'training options');
  assertStudentId(options.student_id);
  assertId(options.question_id, 'question_id');
  const maxHints = Object.hasOwn(options, 'max_hints') ? options.max_hints : 2;
  if (!Number.isInteger(maxHints) || maxHints < 0 || maxHints > 2) {
    throw new Error('max_hints: expected integer from 0 to 2');
  }
  return {
    version: 1, student_id: options.student_id, question_id: options.question_id,
    phase: 'attempt', paused_phase: null, hint_count: 0, max_hints: maxHints,
    initial_independent: null, assisted: false, transfer_passed: false, history: [],
  };
}

function applyEvent(state, event, actor) {
  const requiredActor = USER_EVENTS.includes(event.type) ? 'user' : 'coach';
  if (actor !== requiredActor) throw new Error(`${event.type}: requires trusted ${requiredActor} actor`);
  const prior = state.history.find((entry) => entry.event.id === event.id);
  if (prior) {
    if (prior.actor !== actor || JSON.stringify(prior.event) !== JSON.stringify(event)) {
      throw new Error('event.id: conflicting duplicate');
    }
    return state;
  }
  if (state.history.length >= MAX_HISTORY) throw new Error('history: limit exceeded');
  if (state.phase === 'stopped' || state.phase === 'complete') throw new Error('training is terminal');
  if (event.type === 'STOP') {
    state.phase = 'stopped';
    state.paused_phase = null;
  } else if (event.type === 'PAUSE') {
    if (state.phase === 'paused') throw new Error('already paused');
    state.paused_phase = state.phase;
    state.phase = 'paused';
  } else if (event.type === 'RESUME') {
    if (state.phase !== 'paused') throw new Error('RESUME: not paused');
    state.phase = state.paused_phase;
    state.paused_phase = null;
  } else {
    if (state.phase === 'paused') throw new Error('training is paused');
    if (event.type === 'ATTEMPT') {
      if (state.phase !== 'attempt') throw new Error('ATTEMPT: requires attempt phase');
      if (state.initial_independent === null) state.initial_independent = event.complete;
      if (event.complete) {
        state.assisted = state.hint_count > 0;
        state.phase = 'transfer';
      } else {
        state.phase = state.hint_count < state.max_hints ? 'hint' : 'reveal';
      }
    } else if (event.type === 'HINT') {
      if (state.phase !== 'hint' || state.hint_count >= state.max_hints) {
        throw new Error('HINT: requires hint phase within hint budget');
      }
      const attempt = state.history.findLast((entry) => entry.event.type === 'ATTEMPT');
      if (!attempt?.event.missing_types.includes(event.condition_type)) {
        throw new Error('HINT: condition_type must be evaluated as missing');
      }
      state.hint_count += 1;
      state.phase = 'attempt';
    } else if (event.type === 'REQUEST_REVEAL') {
      if (!['attempt', 'hint'].includes(state.phase)) throw new Error('REQUEST_REVEAL: wrong phase');
      state.phase = 'reveal';
    } else if (event.type === 'REVEALED') {
      if (state.phase !== 'reveal') throw new Error('REVEALED: requires reveal phase');
      state.phase = 'transfer';
    } else if (event.type === 'TRANSFER_ATTEMPT') {
      if (state.phase !== 'transfer') throw new Error('TRANSFER_ATTEMPT: requires transfer phase');
      if (event.transfer_question_id === state.question_id) throw new Error('transfer must use a different question');
      const previouslyHinted = state.history.some((entry) => entry.event.type === 'TRANSFER_ATTEMPT'
        && entry.event.transfer_question_id === event.transfer_question_id && entry.event.hinted);
      if (event.complete && (event.hinted || previouslyHinted)) {
        throw new Error('hinted transfer cannot count as mastery; use a fresh unhinted question');
      }
      if (event.complete) {
        state.transfer_passed = true;
        state.phase = 'complete';
      }
    }
  }
  state.history.push({ actor, event });
  return state;
}

function replayState(state) {
  assertFields(state, STATE_FIELDS, 'state');
  if (state.version !== 1) throw new Error('state: unsupported version');
  const replay = createTraining({
    student_id: state.student_id, question_id: state.question_id, max_hints: state.max_hints,
  });
  if (!PHASES.includes(state.phase) || !Number.isInteger(state.hint_count)
      || state.hint_count < 0 || state.hint_count > state.max_hints
      || (state.initial_independent !== null && typeof state.initial_independent !== 'boolean')) {
    throw new Error('state: invalid phase or counters');
  }
  assertBoolean(state.assisted, 'assisted');
  assertBoolean(state.transfer_passed, 'transfer_passed');
  if (state.paused_phase !== null && !['attempt', 'hint', 'reveal', 'transfer'].includes(state.paused_phase)) {
    throw new Error('state: invalid paused_phase');
  }
  assertArray(state.history, MAX_HISTORY, 'history');
  for (const entry of state.history) {
    assertFields(entry, ['actor', 'event'], 'history entry');
    const previousLength = replay.history.length;
    applyEvent(replay, normalizeEvent(entry.event), entry.actor);
    if (replay.history.length === previousLength) throw new Error('state: duplicate history entry');
  }
  for (const key of STATE_FIELDS.filter((field) => field !== 'history')) {
    if (state[key] !== replay[key]) throw new Error(`state: ${key} disagrees with history replay`);
  }
  if (Buffer.byteLength(JSON.stringify(replay), 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('state: payload limit exceeded');
  return replay;
}

// Throws on any invalid schema, forged derived field, or illegal history transition.
// This is consistency validation, not a signature: the trusted host owns state/history.
export function validateTraining(state) {
  replayState(state);
  return true;
}

export function reduceTraining(state, event, context) {
  validateContext(context);
  const result = replayState(state);
  if (context.student_id !== result.student_id) throw new Error('student context does not own training');
  return applyEvent(result, normalizeEvent(event), context.actor);
}

export async function readJsonInput(stream = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_PAYLOAD_BYTES) throw new Error('stdin: payload limit exceeded');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--student', '--actor'].includes(argv[i]) || flags.has(argv[i])
        || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('usage: training_state.mjs --student s_ID --actor user|coach');
    flags.set(argv[i], argv[i + 1]);
  }
  const context = { student_id: flags.get('--student'), actor: flags.get('--actor') };
  validateContext(context);
  const input = await readJsonInput();
  assertFields(input, ['state', 'event'], 'stdin');
  // Creation is explicit, still scoped to CLI identity. Null event only validates/creates.
  const state = input.state?.version === undefined ? createTraining(input.state) : input.state;
  validateTraining(state);
  if (state.student_id !== context.student_id) throw new Error('student context does not own training');
  const output = input.event === null ? state : reduceTraining(state, input.event, context);
  process.stdout.write(`${JSON.stringify(output)}\n`);
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
    // Never echo untrusted input, IDs, answers, filenames or JSON parser excerpts.
    process.stderr.write('training_state: invalid input or unauthorized transition\n');
    process.exitCode = 1;
  });
}
