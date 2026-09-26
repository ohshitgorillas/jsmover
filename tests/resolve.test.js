import { test } from "node:test";
import assert from "node:assert/strict";
import { AmbiguousSpecifier, resolve } from "../src/resolve.js";

/**
 * A specifier site in `file` whose literal holds `text`.
 * @param {string} file root-relative path of the importing file
 * @param {string} text the specifier
 * @returns {import("../src/parse.js").Site} the site
 */
function site(file, text) {
  return { file, start: 8, end: 8 + text.length, text, line: 1, kind: "import" };
}

/**
 * The AmbiguousSpecifier `fn` throws, or null when it returns.
 * @param {() => unknown} fn the call to run
 * @returns {AmbiguousSpecifier | null} the thrown error
 */
function ambiguity(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AmbiguousSpecifier) return error;
    throw error;
  }
  return null;
}

const NESTED = new Set(["a/x.js", "a/b/x.js", "a/b/c.js"]);

test("a ../ specifier resolves against the importing file's parent directory", () => {
  assert.equal(resolve(site("a/b/c.js", "../x.js"), NESTED), "a/x.js");
});

test("a ./ specifier resolves against the importing file's own directory", () => {
  assert.equal(resolve(site("a/b/c.js", "./x.js"), NESTED), "a/b/x.js");
});

test("an exact match wins over every probed candidate", () => {
  const files = new Set(["lib/x", "lib/x.js", "lib/x.mjs", "lib/x/index.js"]);
  assert.equal(resolve(site("lib/m.js", "./x"), files), "lib/x");
});

for (const suffix of [".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs"]) {
  test(`an extensionless specifier resolves to its ${suffix} candidate`, () => {
    const files = new Set(["lib/m.js", `lib/x${suffix}`]);
    assert.equal(resolve(site("lib/m.js", "./x"), files), `lib/x${suffix}`);
  });
}

test("a specifier matching no probed candidate resolves apart from one naming the file", () => {
  const files = new Set(["lib/m.js", "lib/x.ts"]);
  assert.notDeepStrictEqual(resolve(site("lib/m.js", "./x"), files), resolve(site("lib/m.js", "./x.ts"), files));
});

for (const [form, text, file] of [
  ["a bare", "lib/x.js", "lib/x.js"],
  ["an absolute", "/lib/x.js", "lib/x.js"],
  ["a node:", "node:x", "node:x.js"],
]) {
  test(`${form} specifier is not resolved like the relative one naming the same file`, () => {
    const files = new Set(["main.js", file]);
    assert.notDeepStrictEqual(resolve(site("main.js", text), files), resolve(site("main.js", `./${text}`), files));
  });
}

const TWIN = new Set(["lib/m.js", "lib/x.js", "lib/x.mjs"]);

test("a specifier matching two probed candidates throws AmbiguousSpecifier", () => {
  assert.throws(() => resolve(site("lib/m.js", "./x"), TWIN), AmbiguousSpecifier);
});

test("an ambiguous specifier lists every matching candidate", () => {
  const error = ambiguity(() => resolve(site("lib/m.js", "./x"), TWIN));
  assert.deepStrictEqual([...(error?.candidates ?? [])].sort(), ["lib/x.js", "lib/x.mjs"]);
});

test("an ambiguous specifier carries the site that named it", () => {
  const named = site("lib/m.js", "./x");
  assert.equal(ambiguity(() => resolve(named, TWIN))?.site, named);
});

test("a file probe and a directory index probe matching together are ambiguous", () => {
  const files = new Set(["lib/m.js", "lib/x.js", "lib/x/index.js"]);
  assert.throws(() => resolve(site("lib/m.js", "./x"), files), AmbiguousSpecifier);
});
