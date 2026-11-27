// 文本与公式处理：Mermaid 不支持 LaTeX，图内必须先转成 Unicode/纯文本。

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS = {
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', ast: '∗',
  le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥',
  ll: '≪', gg: '≫',
  ne: '≠', neq: '≠', approx: '≈', equiv: '≡', propto: '∝', sim: '∽',
  cong: '≌', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅',
  varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',
  complement: '∁', square: '□', odot: '⊙', lnot: '¬', neg: '¬',
  langle: '⟨', rangle: '⟩', mid: '|', nmid: '∤',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  longrightarrow: '⟶', longleftarrow: '⟵', Longrightarrow: '⟹',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', uparrow: '↑',
  downarrow: '↓', updownarrow: '↕', sum: '∑', prod: '∏', int: '∫',
  partial: '∂', nabla: '∇', perp: '⊥', parallel: '∥', angle: '∠',
  triangle: '△', because: '∵', therefore: '∴', degree: '°', prime: '′',
  ldots: '…', cdots: '…', dots: '…', quad: ' ', qquad: '  ', circ: '°',
  rightleftharpoons: '⇌', leftrightharpoons: '⇌', longrightleftharpoons: '⇌',
  rightleftarrows: '⇄', leftrightarrows: '⇄', xlongequal: '＝',
  '%': '%', '&': '&', '#': '#', '_': '_', '{': '{', '}': '}',
  '\\': ' ', ' ': ' ', ',': ' ', ';': ' ', ':': ' ', '!': '',
};

// 数学函数名：\sin\alpha -> sin α，保留可读空格。
const FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'ln', 'log', 'lg', 'exp', 'lim', 'max', 'min',
  'sup', 'inf', 'det', 'gcd', 'deg', 'dim', 'ker', 'hom', 'arg',
]);

// 双线体字母（集合数集等）。
const BLACKBOARD = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', A: '𝔸', B: '𝔹',
  H: 'ℍ', F: '𝔽', E: '𝔼', D: '𝔻', K: '𝕂', I: '𝕀', J: '𝕁', L: '𝕃',
  M: '𝕄', O: '𝕆', S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏',
  Y: '𝕐',
};

const NEGATED = {
  in: '∉', ni: '∋', subset: '⊄', subseteq: '⊈', supset: '⊅',
  supseteq: '⊉', '=': '≠', '<': '≮', '>': '≯', parallel: '∦',
  equiv: '≢', sim: '≁', approx: '≉', mid: '∤',
};

const SUP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵',
  '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
  '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ',
};
const SUB = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅',
  '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋',
  '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ',
  h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
};

function readGroup(text, start) {
  // start points at '{'; return [content, nextIndex] with balanced braces.
  if (text[start] !== '{') return [null, start];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return [text.slice(start + 1, i), i + 1];
    }
  }
  return [text.slice(start + 1), text.length];
}

function readCommandArg(text, start) {
  // Skip whitespace, then read a {...} group or a single token.
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === '{') return readGroup(text, i);
  if (i < text.length) return [text[i], i + 1];
  return ['', i];
}

function replaceCommands(text) {
  // Handle commands with one or two arguments first, recursively.
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '\\') {
      out += text[i++];
      continue;
    }
    const rest = text.slice(i + 1);
    const m = /^([A-Za-z]+|.)/.exec(rest);
    if (!m) { i++; continue; }
    const name = m[1];
    let j = i + 1 + name.length;

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const [a, j1] = readCommandArg(text, j);
      const [b, j2] = readCommandArg(text, j1);
      out += `(${replaceCommands(a ?? '')})/(${replaceCommands(b ?? '')})`;
      i = j2;
      continue;
    }
    if (name === 'sqrt') {
      let index = '';
      if (text[j] === '[') {
        const end = text.indexOf(']', j);
        if (end !== -1) { index = text.slice(j + 1, end); j = end + 1; }
      }
      const [a, j1] = readCommandArg(text, j);
      out += `${index ? replaceCommands(index) : ''}√(${replaceCommands(a ?? '')})`;
      i = j1;
      continue;
    }
    if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'ce', 'pu'].includes(name)) {
      const [a, j1] = readCommandArg(text, j);
      let inner = replaceCommands(a ?? '');
      if (name === 'ce') inner = chemicalText(inner);
      out += inner;
      i = j1;
      continue;
    }
    if (name === 'vec' || name === 'overrightarrow' || name === 'overleftarrow') {
      const [a, j1] = readCommandArg(text, j);
      out += `${replaceCommands(a ?? '')}⃗`;
      i = j1;
      continue;
    }
    if (name === 'ddot' || name === 'dot' || name === 'hat' || name === 'tilde') {
      const [a, j1] = readCommandArg(text, j);
      const mark = { ddot: '\u0308', dot: '\u0307', hat: '\u0302', tilde: '\u0303' }[name];
      // 组合附加符放在首字符后；空参数时退化为独立符号。
      const inner = replaceCommands(a ?? '');
      out += inner ? inner[0] + mark + inner.slice(1) : mark;
      i = j1;
      continue;
    }
    if (name === 'overline' || name === 'underline' || name === 'bar' || name === 'hat') {
      const [a, j1] = readCommandArg(text, j);
      out += replaceCommands(a ?? '');
      i = j1;
      continue;
    }
    if (name === 'mathbb' || name === 'bb') {
      const [a, j1] = readCommandArg(text, j);
      const inner = replaceCommands(a ?? '');
      out += [...inner].map((c) => BLACKBOARD[c] ?? c).join('');
      i = j1;
      continue;
    }
    if (['rm', 'bf', 'it', 'cal', 'sf', 'tt', 'boldsymbol', 'bm'].includes(name)) {
      const [a, j1] = readCommandArg(text, j);
      out += replaceCommands(a ?? '');
      i = j1;
      continue;
    }
    if (name === 'not') {
      // \not\in / \not= / \not\subset -> 组合否定符号。
      const restAfter = text.slice(j);
      const m2 = /^\s*\\([A-Za-z]+|[<>=])/.exec(restAfter);
      if (m2) {
        const target = m2[1];
        const neg = NEGATED[target];
        if (neg) {
          out += neg;
          i = j + m2[0].length;
          continue;
        }
      }
      const [a, j1] = readCommandArg(text, j);
      out += `¬${replaceCommands(a ?? '')}`;
      i = j1;
      continue;
    }
    if (name === 'xrightarrow' || name === 'xleftarrow') {
      const [a, j1] = readCommandArg(text, j);
      out += `${name === 'xrightarrow' ? '→' : '←'}(${replaceCommands(a ?? '')})`;
      i = j1;
      continue;
    }
    if (name === 'xlongequal') {
      const [a, j1] = readCommandArg(text, j);
      out += `＝(${replaceCommands(a ?? '')})`;
      i = j1;
      continue;
    }
    if (name === 'limits' || name === 'nolimits' || name === 'displaystyle' || name === 'textstyle') {
      i = j;
      continue;
    }
    // 题源里的换行常被写成字面量 \n 或双反斜杠，转成句内分隔符，避免进入图内报错。
    if (name === 'n') { out += '；'; i = j; continue; }
    if (name === 'overset' || name === 'underset') {
      const [a, j1] = readCommandArg(text, j);
      const [b, j2] = readCommandArg(text, j1);
      out += `${replaceCommands(b ?? '')}(${replaceCommands(a ?? '')})`;
      i = j2;
      continue;
    }
    if (name === 'begin' || name === 'end') {
      const [a, j1] = readCommandArg(text, j);
      // Keep the environment content; turn row separators into semicolons.
      out += '';
      i = j1;
      continue;
    }
    if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg') {
      i = j;
      continue;
    }
    if (name in SYMBOLS) { out += SYMBOLS[name]; i = j; continue; }
    if (name in GREEK) { out += GREEK[name]; i = j; continue; }
    if (FUNCTION_NAMES.has(name)) { out += `${name} `; i = j; continue; }

    // 修复题源里 \toD / \toNaI 这类“箭头命令与后续字母粘连”的写法。
    const arrowPrefix = ['longrightarrow', 'longleftarrow', 'rightleftharpoons', 'leftrightharpoons',
      'rightleftarrows', 'leftrightarrows', 'rightarrow', 'leftarrow', 'leftrightarrow',
      'Longrightarrow', 'to'].find((p) => name.length > p.length && name.startsWith(p));
    if (arrowPrefix) {
      out += SYMBOLS[arrowPrefix] + name.slice(arrowPrefix.length);
      i = j;
      continue;
    }

    // Unknown command: keep a visible marker so validate can fail loudly.
    out += `⟦\\${name}⟧`;
    i = j;
  }
  return out;
}

function convertScripts(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '^' || ch === '_') {
      const map = ch === '^' ? SUP : SUB;
      let content;
      let next;
      if (text[i + 1] === '{') [content, next] = readGroup(text, i + 1);
      else { content = text[i + 1] ?? ''; next = i + 2; }
      let converted = '';
      for (const c of replaceCommands(content)) converted += map[c] ?? c;
      out += converted;
      i = next;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function chemicalText(text) {
  // mhchem-like: H2O -> H₂O; FeO4^2- -> FeO₄²⁻; arrows kept.
  let s = String(text)
    .replace(/<=>/g, '⇌')
    .replace(/->/g, '→')
    .replace(/<-/g, '←');
  s = s.replace(/([A-Za-z\)\]])(\d+)/g, (_, a, n) => a + [...n].map((c) => SUB[c] ?? c).join(''));
  s = s.replace(/\^\{([0-9]*[+-])\}/g, (_, charge) => [...charge].map((c) => SUP[c] ?? c).join(''));
  s = s.replace(/\^(\d*[+-])/g, (_, charge) => [...charge].map((c) => SUP[c] ?? c).join(''));
  return s;
}

export function normalizeMathText(input) {
  if (input == null) return '';
  let s = String(input);
  // 部分题库/OCR 文本里残留 JSON 的 \uXXXX 转义（如 \u00d7 应显示为 ×）。
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Normalize common delimiters; keep line breaks for <br/>.
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, '$1');
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, '$1');
  s = s.replace(/(?<!\\)\$\$?/g, '');
  s = replaceCommands(s);
  s = s.replace(/\\\\/g, '；');
  s = s.replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, '');
  s = convertScripts(s);
  // Remaining escaped punctuation.
  s = s.replace(/\\([_%&#{}])/g, '$1');
  // Tidy: spaces around Chinese punctuation, collapse.
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*([，。；：、）])\s*/g, '$1').trim();
  return s;
}

export function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toMermaidLabel(input) {
  // Preserve explicit line breaks, then escape HTML-sensitive characters.
  const BR = '\u0000BR\u0000';
  let s = String(input ?? '').replace(/<br\s*\/?>/gi, BR);
  s = normalizeMathText(s);
  // Mermaid 的 htmlLabels 会把 &lt; / &gt; 解码后再当 HTML 解析，
  // 形如 a<b 的文字会被吞掉。图内统一用全角尖括号，保证可读且不被解析。
  s = s.replace(/</g, '＜').replace(/>/g, '＞');
  // ASCII 双引号会截断 Mermaid 的 ["..."] 标签，必须换成全角。
  // 其余特殊字符交给 escapeHtml / 实体转义处理。
  s = s.replace(/"/g, '＂');
  s = escapeHtml(s);
  s = s.replace(/\|/g, '&#124;');
  s = s.replace(/`/g, '&#96;');
  s = s.replace(new RegExp(BR, 'g'), '<br/>');
  return s;
}

export function assertRenderableText(input, where = '文本') {
  const raw = String(input ?? '');
  const problems = [];
  if (/(?<!\\)\$/.test(raw)) problems.push('含未转换的 $ 公式定界符');
  if (/\\[A-Za-z]+/.test(raw)) problems.push('含未转换的 LaTeX 命令');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) problems.push('含控制字符');
  if (problems.length) {
    throw new Error(`${where} 无法安全渲染：${problems.join('；')}。请先改成 Unicode/纯文本，例如 √、≤、π、x²、H₂O。`);
  }
}

export function containsFormula(input) {
  return /(?<!\\)\$|\\[A-Za-z]+/.test(String(input ?? ''));
}

export function suggestText(input) {
  try { return normalizeMathText(input); } catch { return String(input ?? ''); }
}

export function textStats(input) {
  const raw = String(input ?? '');
  return {
    length: raw.length,
    hasFormula: containsFormula(raw),
    hasBr: /<br\s*\/?>/i.test(raw),
    lineCount: raw.split(/<br\s*\/?>/i).length,
  };
}
