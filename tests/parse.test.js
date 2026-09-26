import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, ParseError } from "../src/parse.js";

/**
 * Each site's kind and specifier text, in source order.
 * @param {{ kind: string, text: string }[]} sites
 * @returns {string[][]} `[kind, text]` pairs
 */
function kinds(sites) {
  return sites.map((site) => [site.kind, site.text]);
}

/**
 * The ParseError a parse throws, or undefined when it throws none.
 * @param {string} file root-relative path handed to parse
 * @param {string} text source handed to parse
 * @returns {ParseError | undefined}
 */
function failure(file, text) {
  try {
    parse(file, text);
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  return undefined;
}

test("a static import declaration is an import site", () => {
  assert.deepEqual(kinds(parse("a.js", 'import x from "./b.js";\n').sites), [["import", "./b.js"]]);
});

test("a site's offsets span the literal's contents without its quotes", () => {
  const src = "const pad = 1;\nimport { y } from '../lib/y.js';\n";
  const { sites } = parse("a.js", src);
  const at = src.indexOf("../lib/y.js");
  assert.deepEqual(
    sites.map((site) => [site.start, site.end]),
    [[at, at + "../lib/y.js".length]],
  );
});

test("a site carries the line its literal starts on", () => {
  const src = "// head\n\nimport z from './z.js';\n";
  assert.deepEqual(
    parse("a.js", src).sites.map((site) => site.line),
    [3],
  );
});

test("a site carries the file path parse was given", () => {
  assert.deepEqual(
    parse("src/deep/a.js", 'import "./side.js";\n').sites.map((site) => site.file),
    ["src/deep/a.js"],
  );
});

test("export star from is an export site", () => {
  assert.deepEqual(kinds(parse("i.js", 'export * from "./all.js";\n').sites), [["export", "./all.js"]]);
});

test("export named from is an export site", () => {
  assert.deepEqual(kinds(parse("i.js", 'export { x, y as z } from "./named.js";\n').sites), [["export", "./named.js"]]);
});

test("export star as namespace from is an export site", () => {
  assert.deepEqual(kinds(parse("i.js", 'export * as ns from "./ns.js";\n').sites), [["export", "./ns.js"]]);
});

test("an export with no from clause holds no site", () => {
  const src = 'export const y = 1;\nexport { y as w };\nexport { q } from "./q.js";\n';
  assert.deepEqual(
    parse("i.js", src).sites.map((site) => site.text),
    ["./q.js"],
  );
});

test("import() with a string literal is a dynamic site", () => {
  assert.deepEqual(kinds(parse("a.js", 'const m = await import("./lazy.js");\n').sites), [["dynamic", "./lazy.js"]]);
});

test("require() with a string literal in a non-strict script is a require site", () => {
  const src = 'var mode = 010;\nvar lib = require("./cjs.cjs");\n';
  assert.deepEqual(kinds(parse("a.cjs", src).sites), [["require", "./cjs.cjs"]]);
});

test("import() with a template literal is unresolvable, not a site", () => {
  const src = 'const n = "x";\nimport(`./parts/${n}.js`);\nimport("./ok.js");\n';
  assert.deepEqual(
    parse("a.js", src).sites.map((site) => site.text),
    ["./ok.js"],
  );
});

test("import() with a non-literal argument is reported unresolvable with its line", () => {
  const src = 'const n = "./x.js";\n\nimport(n);\n';
  assert.deepEqual(
    parse("a.js", src).unresolvable.map((site) => [site.kind, site.line]),
    [["dynamic", 3]],
  );
});

test("require() with a non-literal argument is reported unresolvable with its line", () => {
  const src = 'var dir = "./d";\nvar m = require(dir + "/m.js");\n';
  assert.deepEqual(
    parse("a.cjs", src).unresolvable.map((site) => [site.kind, site.line]),
    [["require", 2]],
  );
});

test("calls to functions other than a bare require are not sites", () => {
  const src = 'load("./a.js");\nobj.require("./b.js");\nrequire.resolve("./c.js");\nrequire("./d.js");\n';
  assert.deepEqual(
    parse("a.cjs", src).sites.map((site) => site.text),
    ["./d.js"],
  );
});

test("import-shaped text inside a string literal is not a site", () => {
  const src = 'const s = \'import "./fake.js"\';\nimport "./real.js";\n';
  assert.deepEqual(
    parse("a.js", src).sites.map((site) => site.text),
    ["./real.js"],
  );
});

test("an import() type reference in a comment is a jsdoc site", () => {
  const src = '/** @type {import("./t.js").T} */\nlet t;\nimport "./u.js";\n';
  const jsdoc = parse("a.js", src).sites.filter((site) => site.kind === "jsdoc");
  assert.deepEqual(
    jsdoc.map((site) => site.text),
    ["./t.js"],
  );
});

test("a file that fails both parses throws a ParseError naming the file", () => {
  assert.equal(failure("lib/bad.js", "const a = ;\n")?.file, "lib/bad.js");
});

test("a module's syntax error is reported at its own line and column", () => {
  const src = 'import x from "./x.js";\nconst b = ;\n';
  const error = failure("m.js", src);
  assert.deepEqual([error?.line, error?.column], [2, "const b = ".length]);
});

test("a non-strict script's syntax error is reported at its own line and column", () => {
  const src = "var mode = 010;\n\nvar c = );\n";
  const error = failure("s.cjs", src);
  assert.deepEqual([error?.line, error?.column], [3, "var c = ".length]);
});

test("strings holds every string literal that is not a specifier site, with its line", () => {
  const src = 'import a from "./a.js";\nconst label = "lib/a.js";\nrequire("./b.cjs");\nlog(\'./c.js\', 3);\n';
  const { strings } = parse("s.js", src);
  assert.deepEqual(
    strings?.map((record) => [record.text, record.line]),
    [
      ["lib/a.js", 2],
      ["./c.js", 4],
    ],
  );
});

test("comments holds every comment's body, with its line", () => {
  const src = "// line body\nlet x;\n/* block\n body */\nimport './y.js';\n";
  const { comments } = parse("c.js", src);
  assert.deepEqual(
    comments?.map((record) => [record.text, record.line]),
    [
      [" line body", 1],
      [" block\n body ", 3],
    ],
  );
});
