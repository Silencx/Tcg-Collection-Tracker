// =============================================================================
// state-prefix-scan.mjs — regression guard for the `state.` prefix rule.
//
// state.js keeps every mutable value on one exported `state` object precisely so
// modules can mutate it (see the design note at the top of js/state.js). The
// failure mode that follows is silent: porting old code and forgetting the
// prefix leaves a bare `activeLangs` / `_meta` / `sortDesc`, which is not a
// syntax error — it throws a ReferenceError only once that branch actually runs.
// Four of those shipped undetected. This scan flags any state property name used
// as a bare identifier so the build fails instead.
//
// The name list is derived from the keys of the `state` literal in js/state.js,
// not hardcoded, so adding a property extends the guard automatically.
//
// Zero dependencies (Node built-ins only), matching the rest of tools/.
// Consequently there is no real parser here: `blankNonCode` blanks comments,
// string bodies and regex literals so only executable code is searched.
// Template-literal `${…}` interpolations are deliberately kept — masterset.js
// builds most of its DOM through them, so they are prime bug territory.
// =============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

// A `/` here starts a regex literal rather than a division, judged by the last
// significant character before it. Keyword-led regexes (`return /x/`) fall
// through as division; harmless, since we only ever read identifiers back out.
const REGEX_LEAD = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);

/**
 * Replace every non-executable byte with a space, preserving both length and
 * line breaks so offsets in the result still map onto the original source.
 * Blanked: comments, string/template *text*, regex bodies. Kept: everything
 * else, including the code inside `${…}`.
 */
export function blankNonCode(src) {
  let out = '';
  let i = 0;
  let prev = '';
  // A stack so `${ `nested ${x}` }` unwinds correctly. Each code frame counts
  // its own `{` depth to know which `}` closes the interpolation.
  const stack = [{ type: 'code', depth: 0 }];

  // Consume a backslash escape, keeping a line-continuation's newline.
  const escape = () => { out += ' ' + (src[i + 1] === '\n' ? '\n' : ' '); i += 2; };
  const blank = () => { out += src[i] === '\n' ? '\n' : ' '; i++; };

  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const c2 = src[i + 1];

    if (top.type === 'template') {
      if (c === '\\') { escape(); continue; }
      if (c === '`') { out += ' '; i++; stack.pop(); prev = '`'; continue; }
      if (c === '$' && c2 === '{') { out += '  '; i += 2; stack.push({ type: 'code', depth: 0 }); prev = '{'; continue; }
      blank();
      continue;
    }

    if (c === '/' && c2 === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank();
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      out += ' '; i++;
      while (i < src.length) {
        if (src[i] === '\\') { escape(); continue; }
        if (src[i] === c) { out += ' '; i++; break; }
        blank();
      }
      prev = c;
      continue;
    }
    if (c === '`') { out += ' '; i++; stack.push({ type: 'template' }); continue; }
    if (c === '/' && REGEX_LEAD.has(prev)) {
      out += ' '; i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { escape(); continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { out += ' '; i++; break; }
        blank();
      }
      prev = '/';
      continue;
    }

    if (c === '{') top.depth++;
    else if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { out += ' '; i++; stack.pop(); prev = '}'; continue; }
      top.depth--;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const STATE_LITERAL_RE = /export\s+const\s+state\s*=\s*\{[\s\S]*?\n\};/;

/**
 * Read the property names off the `state` object literal in js/state.js.
 * @returns {{keys: string[], literalRange: [number, number]}} `literalRange` is
 *   the literal's own offsets, so its declaration site can be excluded from the
 *   scan (the keys there are properties, not bare references).
 */
export function readStateKeys(stateSource) {
  const m = STATE_LITERAL_RE.exec(stateSource);
  if (!m) throw new Error('state-prefix-scan: could not locate the `export const state = {…}` literal in js/state.js');

  // Walk the blanked literal tracking nesting, so only the object's OWN keys are
  // collected — not keys of anything nested inside an initialiser. Depth beats
  // an indentation rule, which would quietly under-collect if the file is
  // reformatted.
  const code = blankNonCode(m[0]);
  const keys = [];
  let depth = 0;
  for (const tok of code.matchAll(/[{}[\]()]|([A-Za-z_$][\w$]*)\s*:/g)) {
    if (tok[1]) { if (depth === 1) keys.push(tok[1]); continue; }
    if ('{[('.includes(tok[0])) depth++; else depth--;
  }
  if (!keys.length) throw new Error('state-prefix-scan: the `state` literal parsed to zero keys');
  return { keys, literalRange: [m.index, m.index + m[0].length] };
}

/**
 * Names bound locally in this file (declaration, parameter or destructure) and
 * therefore legitimately usable bare.
 *
 * Scope here is the whole FILE, not the enclosing block — without a parser we
 * cannot do better. The trade-off is that one local `pokemonList` exempts that
 * name for the rest of the file, so the scan reports what it suppressed rather
 * than swallowing it silently.
 */
export function localBindings(code, keys) {
  const found = new Set();
  const alt = keys.join('|');
  const patterns = [
    new RegExp(`\\b(?:const|let|var|function|class)\\s+(${alt})\\b`, 'g'),
    new RegExp(`\\bfunction\\s*[\\w$]*\\s*\\(([^)]*)\\)`, 'g'),
    new RegExp(`\\(([^)]*)\\)\\s*=>`, 'g'),
    new RegExp(`\\bcatch\\s*\\(([^)]*)\\)`, 'g'),
    new RegExp(`\\b(?:const|let|var)\\s*[[{]([^\\]}]*)[\\]}]`, 'g'),
    new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=>`, 'g'),
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      // Split on commas so parameter and destructuring lists are handled the
      // same way; strip defaults, renames and rest syntax down to the binding.
      for (const raw of m[1].split(',')) {
        const name = raw.replace(/[=:].*$/s, '').replace(/^\s*\.\.\./, '').trim();
        if (keys.includes(name)) found.add(name);
      }
    }
  }
  return found;
}

/**
 * Is the identifier starting at `start` a bare reference, rather than a property
 * name or part of a longer word?
 *
 * The subtle case is `.`: it normally means property access (`state.checked`,
 * `input.checked`) and should be ignored — EXCEPT when it is the last dot of a
 * spread, where `[...checked]` really is a bare reference. That distinction is
 * the whole point of this guard: all four of the original ReferenceErrors were
 * spreads (`[...checked]`, `[...activeLangs]`, `[...tmsActiveLangs]`), so a
 * naive "skip anything after a dot" rule misses every single one of them.
 */
function isBareReference(code, start) {
  const prev = code[start - 1];
  if (prev === undefined) return true;
  if (/[\w$'"`]/.test(prev)) return false;
  if (prev !== '.') return true;
  return code.slice(start - 3, start) === '...';
}

/**
 * Flag every state key used as a bare identifier. Comments and string bodies are
 * already blanked by this point; see `isBareReference` for the boundary rules.
 *
 * @param {string} source raw file text
 * @param {string[]} keys state property names
 * @param {{skipRanges?: [number, number][]}} [opts]
 * @returns {{findings: {line, column, name, text}[], suppressed: string[]}}
 */
export function scanSource(source, keys, { skipRanges = [] } = {}) {
  const code = blankNonCode(source);
  if (code.length !== source.length) throw new Error('state-prefix-scan: blanking changed the source length');

  const bound = localBindings(code, keys);
  const active = keys.filter(k => !bound.has(k));
  if (!active.length) return { findings: [], suppressed: [...bound] };

  const lines = source.split('\n');
  // Offset → line index, so findings can quote the ORIGINAL line, not the blanked one.
  const lineStarts = [];
  let at = 0;
  for (const l of lines) { lineStarts.push(at); at += l.length + 1; }

  // Longest first, so a key that is a suffix of another can never win the
  // alternation at the wrong offset.
  const alt = [...active].sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(${alt})\\b`, 'g');
  const findings = [];
  for (const m of code.matchAll(re)) {
    const start = m.index;
    if (!isBareReference(code, start)) continue;
    if (skipRanges.some(([a, b]) => start >= a && start < b)) continue;
    let line = lineStarts.findIndex(s => s > start);
    line = line === -1 ? lineStarts.length - 1 : line - 1;
    findings.push({
      line: line + 1,
      column: start - lineStarts[line] + 1,
      name: m[1],
      text: lines[line].trim(),
    });
  }
  return { findings, suppressed: [...bound] };
}

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJs(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Run the scan across js/**\/*.js.
 * @returns {{findings: object[], suppressed: object[], files: number, keys: string[]}}
 */
export function scanRepo(root) {
  const stateFile = resolve(root, 'js/state.js');
  const stateSource = readFileSync(stateFile, 'utf8');
  const { keys, literalRange } = readStateKeys(stateSource);

  const findings = [];
  const suppressed = [];
  const files = walkJs(resolve(root, 'js')).sort();
  for (const file of files) {
    const source = file === stateFile ? stateSource : readFileSync(file, 'utf8');
    const rel = relative(root, file).replace(/\\/g, '/');
    const result = scanSource(source, keys, { skipRanges: file === stateFile ? [literalRange] : [] });
    for (const f of result.findings) findings.push({ file: rel, ...f });
    for (const name of result.suppressed) suppressed.push({ file: rel, name });
  }
  return { findings, suppressed, files: files.length, keys };
}
