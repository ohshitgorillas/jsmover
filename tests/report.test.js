import { test } from "node:test";
import assert from "node:assert/strict";
import { planLines, staleLines } from "../src/report.js";

/**
 * A site in `file` at `line` whose literal holds `text`.
 * @param {string} file root-relative path of the file holding the site
 * @param {number} line line the literal starts on
 * @param {string} text the literal's contents
 * @param {string} kind the site kind
 * @returns {import("../src/parse.js").Site} the site
 */
function site(file, line, text, kind = "import") {
  return { file, start: 10, end: 10 + text.length, text, line, kind };
}

/**
 * A rewrite of `text` to `replacement` in `file` at `line`.
 * @param {string} file root-relative path of the file holding the site
 * @param {number} line line the literal starts on
 * @param {string} text the specifier before the move
 * @param {string} replacement the specifier after the move
 * @returns {import("../src/plan.js").Rewrite} the rewrite
 */
function rewrite(file, line, text, replacement) {
  return { ...site(file, line, text), replacement };
}

/**
 * A string literal or comment record in `file` at `line` holding `text`.
 * @param {string} file root-relative path of the file holding the text
 * @param {number} line line the text starts on
 * @param {string} text the literal's contents or the comment's body
 * @returns {{ file: string, start: number, end: number, text: string, line: number }} the record
 */
function literal(file, line, text) {
  return { file, start: 4, end: 4 + text.length, text, line };
}

const NO_PLAN = { moves: [], rewrites: [], unresolvable: [] };

test("a move prints its old and new paths", () => {
  const plan = { ...NO_PLAN, moves: [{ from: "lib/coerce.js", to: "lib/core/coerce.js" }] };
  assert.deepEqual(planLines(plan), ["move: lib/coerce.js -> lib/core/coerce.js"]);
});

test("a rewrite prints its file, line, old specifier and new specifier", () => {
  const plan = { ...NO_PLAN, rewrites: [rewrite("app/main.js", 7, "../lib/coerce.js", "../lib/core/coerce.js")] };
  assert.deepEqual(planLines(plan), ["app/main.js:7: ../lib/coerce.js -> ../lib/core/coerce.js"]);
});

test("an unresolvable dynamic site prints its file and line", () => {
  const plan = { ...NO_PLAN, unresolvable: [site("views/loader.js", 12, "`./parts/${n}.js`", "dynamic")] };
  assert.deepEqual(planLines(plan), ["views/loader.js:12: unresolvable dynamic specifier"]);
});

test("moves come before rewrites and rewrites before unresolvable sites", () => {
  const plan = {
    moves: [{ from: "z/old.js", to: "z/new.js" }],
    rewrites: [rewrite("a/first.js", 1, "../z/old.js", "../z/new.js")],
    unresolvable: [site("a/first.js", 1, "name", "require")],
  };
  assert.deepEqual(planLines(plan), [
    "move: z/old.js -> z/new.js",
    "a/first.js:1: ../z/old.js -> ../z/new.js",
    "a/first.js:1: unresolvable dynamic specifier",
  ]);
});

test("rewrites are listed by file, then by line within a file", () => {
  const plan = {
    ...NO_PLAN,
    rewrites: [
      rewrite("b.js", 10, "./ten.js", "./x/ten.js"),
      rewrite("b.js", 9, "./nine.js", "./x/nine.js"),
      rewrite("a/z.js", 3, "../three.js", "../x/three.js"),
    ],
  };
  assert.deepEqual(planLines(plan), [
    "a/z.js:3: ../three.js -> ../x/three.js",
    "b.js:9: ./nine.js -> ./x/nine.js",
    "b.js:10: ./ten.js -> ./x/ten.js",
  ]);
});

test("unresolvable sites are listed by file, then by line within a file", () => {
  const plan = {
    ...NO_PLAN,
    unresolvable: [site("m.js", 20, "b", "dynamic"), site("m.js", 4, "a", "require"), site("k.js", 30, "c", "dynamic")],
  };
  assert.deepEqual(planLines(plan), [
    "k.js:30: unresolvable dynamic specifier",
    "m.js:4: unresolvable dynamic specifier",
    "m.js:20: unresolvable dynamic specifier",
  ]);
});

test("moves are listed by their old path", () => {
  const plan = {
    ...NO_PLAN,
    moves: [
      { from: "web/b.js", to: "out/b.js" },
      { from: "web/a.js", to: "out/a.js" },
    ],
  };
  assert.deepEqual(planLines(plan), ["move: web/a.js -> out/a.js", "move: web/b.js -> out/b.js"]);
});

const COERCE = { from: "lib/coerce.js", to: "lib/core/coerce.js" };

test("a string literal holding the old root-relative path is listed with its file and line", () => {
  const strings = [literal("app/routes.js", 14, "lib/coerce.js"), literal("app/routes.js", 15, "lib/dom.js")];
  assert.deepEqual(staleLines(COERCE, strings, []), ["app/routes.js:14: lib/coerce.js"]);
});

test("a comment holding the old root-relative path is listed with its file and line", () => {
  const comments = [literal("app/notes.js", 2, " mirrors lib/coerce.js "), literal("app/notes.js", 5, " unrelated ")];
  assert.deepEqual(staleLines(COERCE, [], comments), ["app/notes.js:2:  mirrors lib/coerce.js "]);
});

test("a relative path is listed only where it resolves from its own file to the old location", () => {
  const strings = [literal("lib/dom.js", 3, "./coerce.js"), literal("app/main.js", 8, "./coerce.js")];
  assert.deepEqual(staleLines(COERCE, strings, []), ["lib/dom.js:3: ./coerce.js"]);
});

test("a relative path inside comment prose is listed when it resolves to the old location", () => {
  const comments = [literal("lib/dom.js", 6, " see ./coerce.js for the rules ")];
  assert.deepEqual(staleLines(COERCE, [], comments), ["lib/dom.js:6:  see ./coerce.js for the rules "]);
});

test("an extensionless relative path that probes to the old location is listed", () => {
  const strings = [literal("lib/dom.js", 9, "./coerce"), literal("lib/dom.js", 10, "./coercion")];
  assert.deepEqual(staleLines(COERCE, strings, []), ["lib/dom.js:9: ./coerce"]);
});

test("a relative path to a file beneath a moved directory is listed", () => {
  const move = { from: "components/narrowbar", to: "components/narrow" };
  const strings = [
    literal("components/binder.js", 21, "./narrowbar/facettip.js"),
    literal("components/binder.js", 22, "./narrowbarx/facettip.js"),
  ];
  assert.deepEqual(staleLines(move, strings, []), ["components/binder.js:21: ./narrowbar/facettip.js"]);
});
