#!/usr/bin/env node
// 统一 OCR 入口（跨平台）：macOS Vision → tesseract → 明确报错。
// 用法: node scripts/ocr.mjs <图片1> [图片2 ...] [--langs zh-Hans,en-US] [--engine auto|vision|tesseract] [--json]
//
// 设计原则：只在真正识别到文字时返回成功；引擎缺失、语言包缺失或图片读不出时给出明确错误，
// 不静默返回空文本，也不假装识别成功。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VISION_SCRIPT = path.join(HERE, 'ocr.swift');
const MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_LANGS = ['zh-Hans', 'en-US'];
const ENGINES = new Set(['auto', 'vision', 'tesseract']);

const USAGE = `用法: node scripts/ocr.mjs <图片1> [图片2 ...] [选项]

用途: 非多模态模型的降级链路。模型支持视觉时应直接读图，不要调用本脚本。

选项:
  --langs <列表>   识别语言，逗号分隔（默认: ${DEFAULT_LANGS.join(',')}）
  --engine <引擎>  auto | vision | tesseract（默认: auto）
  --json           以 JSON 输出每张图片的结果
  -h, --help       显示帮助

引擎顺序（--engine auto）:
  1. macOS 且装有 Swift 工具链 → 系统 Vision（离线、零额外依赖）
  2. 否则或 Vision 失败 → tesseract（需自行安装；中文需 chi_sim 语言包）
  3. 都不可用 → 明确报错，不伪造识别结果

示例:
  node scripts/ocr.mjs photo.png
  node scripts/ocr.mjs a.png b.png --langs zh-Hans,en-US
  node scripts/ocr.mjs scan.png --engine tesseract --langs eng`;

// 语言别名：Vision 用 BCP-47，tesseract 用 traineddata 名。
const VISION_ALIASES = {
  zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-hans': 'zh-Hans', 'chi-sim': 'zh-Hans',
  'zh-tw': 'zh-Hant', 'zh-hant': 'zh-Hant', 'chi-tra': 'zh-Hant',
  en: 'en-US', eng: 'en-US', 'en-us': 'en-US', 'en-gb': 'en-GB',
  ja: 'ja-JP', jpn: 'ja-JP', 'ja-jp': 'ja-JP',
  ko: 'ko-KR', kor: 'ko-KR', 'ko-kr': 'ko-KR',
  fr: 'fr-FR', fra: 'fr-FR', 'fr-fr': 'fr-FR',
  de: 'de-DE', deu: 'de-DE', 'de-de': 'de-DE',
  es: 'es-ES', spa: 'es-ES', 'es-es': 'es-ES',
  ru: 'ru-RU', rus: 'ru-RU', 'ru-ru': 'ru-RU',
  it: 'it-IT', ita: 'it-IT', 'it-it': 'it-IT',
  pt: 'pt-BR', por: 'pt-BR', 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT',
  yue: 'yue-Hans', 'yue-hans': 'yue-Hans', 'yue-hant': 'yue-Hant',
  th: 'th-TH', 'th-th': 'th-TH', vi: 'vi-VT', 'vi-vt': 'vi-VT',
  ar: 'ar-SA', 'ar-sa': 'ar-SA', tr: 'tr-TR', 'tr-tr': 'tr-TR',
  nl: 'nl-NL', 'nl-nl': 'nl-NL', pl: 'pl-PL', 'pl-pl': 'pl-PL',
  sv: 'sv-SE', 'sv-se': 'sv-SE', fi: 'fi-FI', 'fi-fi': 'fi-FI',
  cs: 'cs-CZ', 'cs-cz': 'cs-CZ', da: 'da-DK', 'da-dk': 'da-DK',
  no: 'nb-NO', nb: 'nb-NO', ro: 'ro-RO', 'ro-ro': 'ro-RO',
  uk: 'uk-UA', 'uk-ua': 'uk-UA', hi: 'hi-IN', 'hi-in': 'hi-IN',
  id: 'id-ID', 'id-id': 'id-ID', ms: 'ms-MY', 'ms-my': 'ms-MY',
};

const TESSERACT_ALIASES = {
  zh: 'chi_sim', 'zh-cn': 'chi_sim', 'zh-hans': 'chi_sim', 'chi-sim': 'chi_sim', chi_sim: 'chi_sim',
  'zh-tw': 'chi_tra', 'zh-hant': 'chi_tra', 'chi-tra': 'chi_tra', chi_tra: 'chi_tra',
  en: 'eng', eng: 'eng', 'en-us': 'eng', 'en-gb': 'eng',
  ja: 'jpn', jpn: 'jpn', 'ja-jp': 'jpn',
  ko: 'kor', kor: 'kor', 'ko-kr': 'kor',
  fr: 'fra', fra: 'fra', 'fr-fr': 'fra',
  de: 'deu', deu: 'deu', 'de-de': 'deu',
  es: 'spa', spa: 'spa', 'es-es': 'spa',
  ru: 'rus', rus: 'rus', 'ru-ru': 'rus',
  it: 'ita', ita: 'ita', 'it-it': 'ita',
  pt: 'por', por: 'por', 'pt-br': 'por', 'pt-pt': 'por',
  yue: 'chi_sim', 'yue-hans': 'chi_sim', 'yue-hant': 'chi_tra',
  th: 'tha', 'th-th': 'tha', vi: 'vie', 'vi-vt': 'vie',
  ar: 'ara', 'ar-sa': 'ara', tr: 'tur', 'tr-tr': 'tur',
  nl: 'nld', 'nl-nl': 'nld', pl: 'pol', 'pl-pl': 'pol',
  sv: 'swe', 'sv-se': 'swe', fi: 'fin', 'fi-fi': 'fin',
  cs: 'ces', 'cs-cz': 'ces', da: 'dan', 'da-dk': 'dan',
  no: 'nor', nb: 'nor', ro: 'ron', 'ro-ro': 'ron',
  uk: 'ukr', 'uk-ua': 'ukr', hi: 'hin', 'hi-in': 'hin',
  id: 'ind', 'id-id': 'ind', ms: 'msa', 'ms-my': 'msa',
  bn: 'ben', 'bn-bd': 'ben', 'bn-in': 'ben',
};

const normalizeKey = (token) => token.trim().toLowerCase().replace(/_/g, '-');

function toVisionLangs(langs) {
  return [...new Set(langs.map((lang) => VISION_ALIASES[normalizeKey(lang)] ?? lang.trim()))];
}

function toTesseractLangs(langs) {
  return [...new Set(langs.map((lang) => TESSERACT_ALIASES[normalizeKey(lang)] ?? normalizeKey(lang).replace(/-/g, '_')))];
}

function failUsage(message) {
  console.error(`参数错误: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const paths = [];
  let langs = [...DEFAULT_LANGS];
  let engine = 'auto';
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--langs' || arg.startsWith('--langs=')) {
      const value = arg.startsWith('--langs=') ? arg.slice('--langs='.length) : argv[++i];
      if (!value) failUsage('--langs 需要一个语言列表');
      const parsed = value.split(/[,+]/).map((item) => item.trim()).filter(Boolean);
      if (parsed.length === 0) failUsage('--langs 不能为空');
      langs = parsed;
    } else if (arg === '--engine' || arg.startsWith('--engine=')) {
      const value = arg.startsWith('--engine=') ? arg.slice('--engine='.length) : argv[++i];
      if (!value || !ENGINES.has(value)) failUsage(`--engine 只支持 ${[...ENGINES].join(' | ')}`);
      engine = value;
    } else if (arg === '--') {
      paths.push(...argv.slice(i + 1));
      break;
    } else if (arg.startsWith('-')) {
      failUsage(`未知选项: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) failUsage('至少需要一张图片');
  return { paths, langs, engine, json };
}

function commandWorks(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { stdio: 'ignore', timeout: 15_000 });
  return !result.error && result.status === 0;
}

function runVision(paths, langs) {
  const args = [VISION_SCRIPT, ...paths, '--langs', langs.join(',')];
  const result = spawnSync('swift', args, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: MAX_BUFFER,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error,
  };
}

// 按 ocr.swift 的 "--- 路径 ---" 分隔符还原每张图片的文本；重复路径也能按顺序对齐。
function parseVisionOutput(stdout, paths) {
  if (paths.length === 1) return [{ path: paths[0], text: stdout.trim() }];

  const parsed = [];
  let cursor = 0;
  for (let index = 0; index < paths.length; index += 1) {
    const marker = `--- ${paths[index]} ---`;
    const start = stdout.indexOf(marker, cursor);
    if (start === -1) {
      parsed.push({ path: paths[index], text: '' });
      continue;
    }
    const bodyStart = start + marker.length;
    const nextMarker = index + 1 < paths.length ? stdout.indexOf(`--- ${paths[index + 1]} ---`, bodyStart) : -1;
    const end = nextMarker === -1 ? stdout.length : nextMarker;
    parsed.push({ path: paths[index], text: stdout.slice(bodyStart, end).trim() });
    cursor = bodyStart;
  }
  return parsed;
}

function visionErrorFor(stderr, imagePath) {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => line.includes(imagePath))
    ?? lines.find((line) => /OCR 失败|无法读取图片|未识别到文字|不支持|error/i.test(line))
    ?? lines[0]
    ?? '';
}

function tesseractSetup(requestedLangs) {
  if (!commandWorks('tesseract')) {
    return { ok: false, error: '未找到 tesseract 命令' };
  }

  const result = spawnSync('tesseract', ['--list-langs'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) return { ok: false, error: `无法运行 tesseract: ${result.error.message}` };

  const installed = new Set(
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z][a-z0-9_]*$/.test(line)),
  );

  let langs = toTesseractLangs(requestedLangs);
  let missing = [];
  if (installed.size > 0) {
    missing = langs.filter((lang) => !installed.has(lang));
    langs = langs.filter((lang) => installed.has(lang));
  }

  if (langs.length === 0) {
    const available = [...installed].slice(0, 8).join(', ');
    return {
      ok: false,
      error: `tesseract 缺少语言包: ${missing.join(', ') || requestedLangs.join(', ')}；已安装示例: ${available || '无'}`,
    };
  }
  return { ok: true, langs, missing, installed };
}

function runTesseract(imagePath, langs) {
  const result = spawnSync('tesseract', [imagePath, 'stdout', '-l', langs.join('+')], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: MAX_BUFFER,
  });
  const text = (result.stdout ?? '').trim();
  if (result.error) return { text: '', error: `无法运行 tesseract: ${result.error.message}` };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    return { text, error: stderr || `tesseract 退出码 ${result.status}` };
  }
  return { text, error: null };
}

function installHints() {
  return [
    'macOS: 安装 Xcode Command Line Tools 后可用系统 Vision（xcode-select --install）',
    'macOS 备用: brew install tesseract tesseract-lang',
    'Debian/Ubuntu: sudo apt install tesseract-ocr tesseract-ocr-chi-sim',
    'Windows: winget install UB-Mannheim.TesseractOCR，并安装 chi_sim 语言包',
    '或者请用户直接粘贴题目文字。',
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const requestedVisionLangs = toVisionLangs(options.langs);
  const outcomes = options.paths.map((imagePath) => ({
    path: imagePath,
    text: '',
    engine: null,
    error: null,
  }));
  const attempts = [];

  const existingIndexes = [];
  outcomes.forEach((outcome, index) => {
    if (existsSync(outcome.path)) existingIndexes.push(index);
    else outcome.error = '文件不存在';
  });

  const candidateIndexes = [...existingIndexes];
  const candidatePaths = candidateIndexes.map((index) => outcomes[index].path);
  let visionReady = false;
  let tesseractReady = false;

  if (options.engine !== 'tesseract' && candidatePaths.length > 0) {
    const unavailable = process.platform !== 'darwin'
      ? `Vision 不可用: 当前平台 ${process.platform} 不支持 macOS Vision`
      : !existsSync(VISION_SCRIPT)
        ? `Vision 不可用: 缺少 ${VISION_SCRIPT}`
        : '';

    if (unavailable) {
      const reason = unavailable;
      attempts.push(reason);
      for (const index of candidateIndexes) outcomes[index].error = reason;
    } else {
      const run = runVision(candidatePaths, requestedVisionLangs);
      if (run.error && ['ENOENT', 'EACCES'].includes(run.error.code)) {
        const reason = `Vision 不可用: 无法运行 swift（${run.error.message}）`;
        attempts.push(reason);
        for (const index of candidateIndexes) outcomes[index].error = reason;
      } else {
        visionReady = true;
        const parsed = parseVisionOutput(run.stdout, candidatePaths);
        const hardError = run.error
          ? `无法运行 swift: ${run.error.message}`
          : run.status !== 0
            ? `swift 退出码 ${run.status}`
            : '';

        parsed.forEach((item, offset) => {
          const outcome = outcomes[candidateIndexes[offset]];
          outcome.engine = 'vision';
          outcome.text = item.text;
          if (item.text) {
            outcome.error = null;
          } else {
            outcome.error = visionErrorFor(run.stderr, item.path) || hardError || 'Vision 未识别到文字';
          }
        });
        attempts.push('Vision 已尝试');
      }
    }
  }

  const failedIndexes = candidateIndexes.filter((index) => !outcomes[index].text);
  if (options.engine === 'tesseract' || (options.engine === 'auto' && failedIndexes.length > 0)) {
    const setup = tesseractSetup(options.langs);
    if (!setup.ok) {
      attempts.push(`tesseract 不可用: ${setup.error}`);
      if (options.engine === 'tesseract') {
        console.error(`OCR 失败: ${setup.error}`);
        console.error(installHints().map((line) => `  - ${line}`).join('\n'));
        process.exit(1);
      }
    } else {
      tesseractReady = true;
      if (setup.missing.length > 0) {
        console.error(`提示: tesseract 未安装语言包 ${setup.missing.join(', ')}，本次只用 ${setup.langs.join('+')}`);
      }
      const indexes = options.engine === 'tesseract' ? candidateIndexes : failedIndexes;
      for (const index of indexes) {
        const outcome = outcomes[index];
        const result = runTesseract(outcome.path, setup.langs);
        if (result.text) {
          outcome.text = result.text;
          outcome.engine = 'tesseract';
          outcome.error = null;
        } else {
          const reason = result.error || 'tesseract 未识别到文字';
          outcome.error = outcome.error && outcome.engine === 'vision'
            ? `${outcome.error}；${reason}`
            : reason;
          outcome.engine = outcome.engine ?? 'tesseract';
        }
      }
      attempts.push('tesseract 已尝试');
    }
  }

  const failed = outcomes.filter((outcome) => !outcome.text);
  const enginesUsed = [...new Set(outcomes.map((outcome) => outcome.engine).filter(Boolean))];

  if (options.json) {
    console.log(JSON.stringify({
      ok: failed.length === 0,
      platform: process.platform,
      engines: enginesUsed,
      attempts,
      images: outcomes,
    }, null, 2));
  } else {
    outcomes.forEach((outcome, index) => {
      if (outcomes.length > 1) console.log(`--- ${outcome.path} ---`);
      if (outcome.text) console.log(outcome.text);
      if (outcomes.length > 1 && index < outcomes.length - 1) console.log('');
    });
    for (const outcome of failed) {
      console.error(`OCR 失败 ${outcome.path}: ${outcome.error || '未识别到文字'}`);
    }
  }

  if (failed.length > 0) {
    if (candidatePaths.length === 0) {
      // 全是文件不存在等输入错误，不再重复报引擎安装提示。
    } else if (!visionReady && !tesseractReady) {
      console.error('没有可用的 OCR 引擎：');
      console.error(installHints().map((line) => `  - ${line}`).join('\n'));
    }
    if (attempts.length > 0) {
      console.error(`OCR 引擎尝试记录: ${attempts.join('；')}`);
    }
    // 用 exitCode 而不是 process.exit，避免管道输出（尤其 --json）被截断。
    process.exitCode = 1;
  }
}

main();
