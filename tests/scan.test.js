import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isSource, scan } from "../src/scan.js";
import { fixture } from "./support/fixture.js";

/** @type {Record<string, string>} */
const TREE = {
  "app.js": 'import "./lib/util.mjs";\n',
  "lib/util.mjs": "export const u = 1;\n",
  "lib/legacy.cjs": 'module.exports = require("./util.mjs");\n',
  "lib/deep/index.js": "export {};\n",
  "lib/types.ts": "export type T = number;\n",
  "lib/data.json": "{}\n",
  "lib/readme.md": "# lib\n",
  "scripts/pre-commit.js": "export {};\n",
  "node_modules/pkg/lib/util.mjs": "export {};\n",
  ".git/hooks/pre-commit.js": "\n",
};

const root = fixture({ after }, TREE);

test("a .js file at the root is found by its relative path", () => {
  assert.ok(scan(root).includes("app.js"));
});

test("a file nested two directories deep is found by its root-relative path", () => {
  assert.ok(scan(root).includes("lib/deep/index.js"));
});

test(".mjs and .cjs files are found and other extensions beside them are left out", () => {
  const lib = scan(root).filter((path) => isSource(path) && /^lib\/[a-z]+\.[a-z]+$/.test(path));
  assert.deepEqual(lib.sort(), ["lib/legacy.cjs", "lib/util.mjs"]);
});

test("a file under node_modules sharing a scanned path's tail is left out", () => {
  const utils = scan(root).filter((path) => path.endsWith("util.mjs"));
  assert.deepEqual(utils, ["lib/util.mjs"]);
});

test("a file under .git sharing a scanned path's tail is left out", () => {
  const hooks = scan(root).filter((path) => path.endsWith("pre-commit.js"));
  assert.deepEqual(hooks, ["scripts/pre-commit.js"]);
});
