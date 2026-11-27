#!/usr/bin/env node
// 用法: node normalize_question.mjs <questions.json|jsonl> <out.jsonl> [--public-root <dir>] [--with-answer] [--with-solution]
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeMany } from './lib/question.mjs';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) {
  console.error('用法: node normalize_question.mjs <questions.json|jsonl> <out.jsonl> [--public-root <dir>] [--with-answer] [--with-solution]');
  process.exit(2);
}
let publicRoot = 'public';
let includeAnswer = false;
let includeSolution = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--public-root') publicRoot = rest[++i];
  else if (rest[i] === '--with-answer') includeAnswer = true;
  else if (rest[i] === '--with-solution') includeSolution = true;
}
const raw = await readFile(input, 'utf8');
let rows;
if (input.endsWith('.jsonl')) rows = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
else {
  const parsed = JSON.parse(raw);
  rows = Array.isArray(parsed) ? parsed : parsed.questions ?? [parsed];
}
const out = normalizeMany(rows, { publicRoot, includeAnswer, includeSolution });
await writeFile(output, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const warningCount = out.reduce((n, x) => n + x.warnings.length, 0);
const noteCount = out.reduce((n, x) => n + x.notes.length, 0);
const kindCount = Object.fromEntries([...new Set(out.map((x) => x.kind))].map((k) => [k, out.filter((x) => x.kind === k).length]));
console.log(JSON.stringify({ ok: true, questions: out.length, warnings: warningCount, notes: noteCount, kinds: kindCount, output }, null, 2));
