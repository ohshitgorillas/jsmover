import { test } from "node:test";
import assert from "node:assert/strict";
import { jsdocSites } from "../src/jsdoc.js";

/**
 * The range of every block comment in `text`, located by its delimiters.
 * @param {string} text source holding the comments
 * @returns {{ start: number, end: number }[]}
 */
function blocks(text) {
  const ranges = [];
  let from = text.indexOf("/*");
  while (from !== -1) {
    const end = text.indexOf("*/", from) + 2;
    ranges.push({ start: from, end });
    from = text.indexOf("/*", end);
  }
  return ranges;
}

/**
 * Sites for `text`, with its block comments as the comment list.
 * @param {string} file root-relative path
 * @param {string} text source
 */
function sitesOf(file, text) {
  return jsdocSites(file, blocks(text), text);
}

const FIELD = '/** @param {import("../widgets/Field.js").Field} f */\nexport function view(f) {}\n';

test("an import() type reference in a comment is a jsdoc site with its specifier text", () => {
  assert.deepEqual(
    sitesOf("components/live/View.js", FIELD).map((site) => [site.kind, site.text]),
    [["jsdoc", "../widgets/Field.js"]],
  );
});

test("a jsdoc site's offsets span the literal's contents without its quotes", () => {
  const at = FIELD.indexOf("../widgets/Field.js");
  assert.deepEqual(
    sitesOf("components/live/View.js", FIELD).map((site) => [site.start, site.end]),
    [[at, at + "../widgets/Field.js".length]],
  );
});

test("a jsdoc site carries the file path it was given", () => {
  assert.deepEqual(
    sitesOf("components/live/View.js", FIELD).map((site) => site.file),
    ["components/live/View.js"],
  );
});

test("a jsdoc site carries the line of the literal, not of the comment's start", () => {
  const src = "const a = 1;\n/**\n * Doc.\n * @param {import('./deep/t.js').T} t\n */\nfunction g(t) {}\n";
  assert.deepEqual(
    sitesOf("a.js", src).map((site) => site.line),
    [4],
  );
});

test("single-quoted references are sites with their own contents", () => {
  const src = "/** @type {import('./single.js').S} */\nlet s;\n";
  assert.deepEqual(
    sitesOf("a.js", src).map((site) => site.text),
    ["./single.js"],
  );
});

test("every reference in one comment is a site, in source order", () => {
  const src = '/**\n * @param {import("./a.js").A} a\n * @returns {import("../b.js").B}\n */\n';
  assert.deepEqual(
    sitesOf("x/y.js", src).map((site) => site.text),
    ["./a.js", "../b.js"],
  );
});

test("an import() outside every comment is not a jsdoc site", () => {
  const src = 'import("./code.js");\n/** @type {import("./type.js").T} */\nlet t;\n';
  assert.deepEqual(
    sitesOf("a.js", src).map((site) => site.text),
    ["./type.js"],
  );
});

test("a template-literal import() in a comment is not a site", () => {
  const src = '/** see import(`./tpl.js`) and {import("./real.js").R} */\n';
  assert.deepEqual(
    sitesOf("a.js", src).map((site) => site.text),
    ["./real.js"],
  );
});

test("a line comment's import() reference is a site", () => {
  const src = '// @type {import("./line.js").L}\nlet l;\n';
  assert.deepEqual(
    jsdocSites("a.js", [{ start: 0, end: src.indexOf("\n") }], src).map((site) => site.text),
    ["./line.js"],
  );
});
