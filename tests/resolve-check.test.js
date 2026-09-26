import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/resolve-check.mjs", import.meta.url));

/** One planted miss per specifier form, a resolving import, and two look-alikes that are not specifiers. */
const PLANTED = [
  'import { x } from "./missing-static.js";',
  'export { y } from "./missing-export.js";',
  'const lazy = () => import("./missing-dynamic.js");',
  'const req = require("./missing-require.cjs");',
  '/** @type {import("./missing-jsdoc.js").T} */',
  "const text = 'import { s } from \"./in-string.js\"';",
  '// import { c } from "./in-comment.js";',
  'import { ok } from "./ok.js";',
  'const tpl = `import { t } from "./in-template.js"`;',
  'const sub = `${ok} import("./in-substitution.js") ${tpl}`;',
  'const re = /from "\\.\\/in-regex\\.js"/;',
  "export { x, lazy, req, text, ok, sub, re };",
].join("\n");

const CODE_MISSES = ["./missing-dynamic.js", "./missing-export.js", "./missing-require.cjs", "./missing-static.js"];

/**
 * A fresh directory holding `files`, keyed by relative path.
 * @param {Record<string, string>} files
 * @returns {string}
 */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "resolve-check-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const planted = tree({ "a.js": PLANTED + "\n", "ok.js": "export const ok = 1;\n" });
const clean = tree({ "b.js": 'import { ok } from "./lib/ok.js";\n', "lib/ok.js": "export const ok = 1;\n" });

after(() => {
  rmSync(planted, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
});

/**
 * Run the oracle and split its stdout into lines.
 * @param {string[]} args
 * @returns {{ status: number | null, lines: string[] }}
 */
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: r.status, lines: r.stdout.split("\n").filter(Boolean) };
}

/**
 * The specifiers named by the miss lines of a run, sorted.
 * @param {string[]} lines
 * @returns {string[]}
 */
function missed(lines) {
  return lines
    .map((l) => /^[^:]+:\d+: (.+)$/.exec(l))
    .flatMap((m) => (m ? [m[1]] : []))
    .sort();
}

const withJsdoc = run([planted, "--jsdoc"]);
const withoutJsdoc = run([planted]);

test("a static import of a missing file is reported at its line", () => {
  assert.ok(withoutJsdoc.lines.includes("a.js:1: ./missing-static.js"));
});

test("an export-from of a missing file is reported at its line", () => {
  assert.ok(withoutJsdoc.lines.includes("a.js:2: ./missing-export.js"));
});

test("a dynamic import() of a missing file is reported at its line", () => {
  assert.ok(withoutJsdoc.lines.includes("a.js:3: ./missing-dynamic.js"));
});

test("a require() of a missing file is reported at its line", () => {
  assert.ok(withoutJsdoc.lines.includes("a.js:4: ./missing-require.cjs"));
});

test("a JSDoc import() of a missing file is reported at its line under --jsdoc", () => {
  assert.ok(withJsdoc.lines.includes("a.js:5: ./missing-jsdoc.js"));
});

test("without --jsdoc exactly the four code sites are reported", () => {
  assert.deepEqual(missed(withoutJsdoc.lines), CODE_MISSES);
});

test("string, comment, template and regex look-alikes of imports are not reported", () => {
  assert.deepEqual(missed(withJsdoc.lines), [...CODE_MISSES, "./missing-jsdoc.js"].sort());
});

test("the summary counts files, checked specifiers and misses", () => {
  assert.ok(withJsdoc.lines.includes("2 files, 6 specifiers checked, 5 unresolved"));
});

test("a tree whose specifiers all resolve is summarised with no misses", () => {
  assert.deepEqual(run([clean]).lines, ["2 files, 1 specifiers checked, 0 unresolved"]);
});

test("any miss exits with status 1", () => {
  assert.equal(withJsdoc.status, 1);
});

test("a missing directory argument exits with usage status 2", () => {
  assert.equal(run([]).status, 2);
});
