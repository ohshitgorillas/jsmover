#!/usr/bin/env node
// Resolution oracle: every relative specifier under a directory must name an
// existing file exactly, the way a browser resolves an ES module URL, with no
// extension probing and no directory index. It carries its own lexer and
// imports nothing from src/, so a defect in jsmover's parser cannot hide itself.
//
//   node scripts/resolve-check.mjs <dir> [--jsdoc]
//
// Checked forms: `import ... from "x"`, `import "x"`, `export ... from "x"`,
// `import("x")` and `require("x")` with a string-literal argument. `--jsdoc`
// adds `import("x")` inside comments. Each miss prints `<path>:<line>: <spec>`,
// then one summary line; exit 1 on any miss, 2 on a usage error.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const USAGE = "usage: node scripts/resolve-check.mjs <dir> [--jsdoc]\n";

/**
 * The directory and options named on the command line, or exit 2.
 * @param {string[]} argv
 * @returns {{ root: string, jsdoc: boolean }}
 */
function parseArgs(argv) {
  const dirs = argv.filter((a) => !a.startsWith("--"));
  const flags = argv.filter((a) => a.startsWith("--"));
  const unknown = flags.filter((f) => f !== "--jsdoc");
  const root = dirs.length === 1 ? path.resolve(dirs[0]) : "";
  if (unknown.length || !root || !isDir(root)) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  return { root, jsdoc: flags.includes("--jsdoc") };
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const SOURCE = /\.(m?js|cjs|jsx)$/;

/**
 * Every source file under `dir` in name order, skipping dot entries and node_modules.
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile() && SOURCE.test(ent.name)) yield p;
  }
}

// ---- lexer ------------------------------------------------------------------
// Emits significant tokens {t: "id" | "str" | "tpl" | "p" | "num" | "re", v, line}
// and comments {text, line}. A template with no substitution is a "str" token;
// template pieces around a substitution are "tpl" and never a specifier. The
// previous significant token decides whether `/` opens a regex or divides.

const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
  "extends",
]);
const CLOSERS = new Set([")", "]", "}"]);
const SPACE = new Set([" ", "\t", "\r", "\f", "\v", "﻿", " ", " ", " "]);
const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT = /[0-9]/;
const NUM_PART = /[0-9A-Za-z_.]/;

class Lexer {
  /** @param {string} src */
  constructor(src) {
    this.src = src;
    this.i = 0;
    this.line = 1;
    this.toks = [];
    this.comments = [];
    this.braceDepth = 0;
    this.tplStack = [];
  }

  peek(k = 0) {
    return this.src[this.i + k] ?? "";
  }

  push(t, v, line = this.line) {
    this.toks.push({ t, v, line });
  }

  regexAllowed() {
    const prev = this.toks[this.toks.length - 1];
    if (!prev) return true;
    if (prev.t === "id") return REGEX_AFTER_WORD.has(prev.v);
    if (prev.t === "p") return !CLOSERS.has(prev.v);
    return false;
  }

  run() {
    while (this.i < this.src.length) this.step();
    return { toks: this.toks, comments: this.comments };
  }

  step() {
    const c = this.peek();
    if (c === "\n") {
      this.line++;
      this.i++;
    } else if (SPACE.has(c)) this.i++;
    else if (c === "/" && this.peek(1) === "/") this.lineComment();
    else if (c === "/" && this.peek(1) === "*") this.blockComment();
    else if (c === "#" && this.i === 0 && this.peek(1) === "!") this.skipLine();
    else if (c === "'" || c === '"') this.string(c);
    else if (c === "`") this.template();
    else if (c === "{") this.openBrace();
    else if (c === "}") this.closeBrace();
    else if (c === "/" && this.regexAllowed()) this.regex();
    else if (DIGIT.test(c) || (c === "." && DIGIT.test(this.peek(1)))) this.number();
    else if (ID_START.test(c) || c === "\\" || (c === "#" && ID_START.test(this.peek(1)))) this.word();
    else this.punct(c);
  }

  skipLine() {
    while (this.i < this.src.length && this.peek() !== "\n") this.i++;
  }

  lineComment() {
    const start = this.i;
    this.skipLine();
    this.comments.push({ text: this.src.slice(start, this.i), line: this.line });
  }

  blockComment() {
    const start = this.i;
    const line = this.line;
    this.i += 2;
    while (this.i < this.src.length && !(this.peek() === "*" && this.peek(1) === "/")) {
      if (this.peek() === "\n") this.line++;
      this.i++;
    }
    this.i += 2;
    this.comments.push({ text: this.src.slice(start, this.i), line });
  }

  string(quote) {
    const line = this.line;
    let v = "";
    this.i++;
    while (this.i < this.src.length && this.peek() !== quote) {
      const c = this.peek();
      if (c === "\n") break;
      if (c === "\\") {
        if (this.peek(1) === "\n") this.line++;
        v += this.peek(1);
        this.i += 2;
        continue;
      }
      v += c;
      this.i++;
    }
    this.i++;
    this.push("str", v, line);
  }

  /** Read a template body up to its closing backtick or the next `${`. */
  templateBody() {
    let text = "";
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c === "`") {
        this.i++;
        return { text, opened: false };
      }
      if (c === "$" && this.peek(1) === "{") {
        this.i += 2;
        this.tplStack.push(this.braceDepth);
        this.braceDepth++;
        return { text, opened: true };
      }
      const step = c === "\\" ? 2 : 1;
      const chunk = this.src.slice(this.i, this.i + step);
      if (chunk.includes("\n")) this.line++;
      text += chunk;
      this.i += step;
    }
    return { text, opened: false };
  }

  template() {
    const line = this.line;
    this.i++;
    const body = this.templateBody();
    this.push(body.opened ? "tpl" : "str", body.text, line);
  }

  openBrace() {
    this.braceDepth++;
    this.push("p", "{");
    this.i++;
  }

  closeBrace() {
    this.i++;
    this.braceDepth--;
    if (this.tplStack.length && this.tplStack[this.tplStack.length - 1] === this.braceDepth) {
      this.tplStack.pop();
      const line = this.line;
      this.push("tpl", this.templateBody().text, line);
      return;
    }
    this.push("p", "}");
  }

  regex() {
    const line = this.line;
    let inClass = false;
    this.i++;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c === "\n") break;
      this.i += c === "\\" ? 2 : 1;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
    }
    while (this.i < this.src.length && ID_PART.test(this.peek())) this.i++;
    this.push("re", "", line);
  }

  number() {
    this.i++;
    while (this.i < this.src.length && NUM_PART.test(this.peek())) this.i++;
    this.push("num", "");
  }

  word() {
    const start = this.i;
    this.i++;
    while (this.i < this.src.length && ID_PART.test(this.peek())) this.i++;
    this.push("id", this.src.slice(start, this.i));
  }

  punct(c) {
    const three = this.src.slice(this.i, this.i + 3);
    const two = this.src.slice(this.i, this.i + 2);
    const v = three === "..." ? three : two === "?." ? two : c;
    this.push("p", v);
    this.i += v.length;
  }
}

// ---- extraction -------------------------------------------------------------

/**
 * The specifier a token sequence starting at `k` introduces, if any.
 * @param {Array<{ t: string, v: string, line: number }>} toks
 * @param {number} k
 * @returns {{ spec: string, line: number } | null}
 */
function specifierAt(toks, k) {
  const tk = toks[k];
  const prev = toks[k - 1];
  if (tk.t !== "id" || (prev && prev.t === "p" && (prev.v === "." || prev.v === "?."))) return null;
  const a = toks[k + 1];
  const b = toks[k + 2];
  if ((tk.v === "from" || tk.v === "import") && a && a.t === "str") return { spec: a.v, line: a.line };
  const call = (tk.v === "import" || tk.v === "require") && a && a.t === "p" && a.v === "(";
  if (call && b && b.t === "str") return { spec: b.v, line: b.line };
  return null;
}

const JSDOC_IMPORT = /import\(\s*(["'`])([^"'`]+)\1\s*\)/g;

/**
 * The `import("x")` references inside comments.
 * @param {Array<{ text: string, line: number }>} comments
 * @returns {Array<{ spec: string, line: number }>}
 */
function commentRefs(comments) {
  const out = [];
  for (const cm of comments) {
    for (const m of cm.text.matchAll(JSDOC_IMPORT)) {
      const newlines = cm.text.slice(0, m.index).split("\n").length - 1;
      out.push({ spec: m[2], line: cm.line + newlines });
    }
  }
  return out;
}

/**
 * Every specifier in `src`, with its line.
 * @param {string} src
 * @param {boolean} jsdoc
 * @returns {Array<{ spec: string, line: number }>}
 */
function extract(src, jsdoc) {
  const { toks, comments } = new Lexer(src).run();
  const refs = toks.map((_, k) => specifierAt(toks, k)).filter((r) => r !== null);
  return jsdoc ? [...refs, ...commentRefs(comments)] : refs;
}

// ---- resolution -------------------------------------------------------------

const isRelative = (s) => s === "." || s === ".." || s.startsWith("./") || s.startsWith("../");

/**
 * Whether `spec`, written in `fromFile`, names an existing file exactly.
 * @param {string} fromFile
 * @param {string} spec
 * @returns {boolean}
 */
function resolves(fromFile, spec) {
  return isFile(path.resolve(path.dirname(fromFile), spec.replace(/[?#].*$/, "")));
}

function main() {
  const { root, jsdoc } = parseArgs(process.argv.slice(2));
  const misses = [];
  let files = 0;
  let checked = 0;
  for (const f of walk(root)) {
    files++;
    const rel = path.relative(root, f);
    const refs = extract(fs.readFileSync(f, "utf8"), jsdoc).filter((r) => isRelative(r.spec));
    checked += refs.length;
    for (const r of refs) if (!resolves(f, r.spec)) misses.push(`${rel}:${r.line}: ${r.spec}\n`);
  }
  process.stdout.write(
    misses.join("") + `${files} files, ${checked} specifiers checked, ${misses.length} unresolved\n`,
  );
  process.exitCode = misses.length ? 1 : 0;
}

main();
