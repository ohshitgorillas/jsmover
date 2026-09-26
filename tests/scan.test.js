import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isSource, scan } from "../src/scan.js";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/fixture.js";
import { git, repo } from "./support/repo.js";

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

test("inside a git work tree a gitignored file sharing a tracked file's tail is left out", (t) => {
  const tree = repo(
    t,
    { ".gitignore": "venv/\n", "lib/index.js": "export {};\n", "venv/pkg/index.js": "export {};\n" },
    {},
  );
  const indexes = scan(tree).filter((path) => path.endsWith("index.js"));
  assert.deepEqual(indexes, ["lib/index.js"]);
});

test("inside a git work tree a linked worktree beneath it is left out", (t) => {
  const tree = repo(t, { "app.js": "export {};\n" }, {});
  git(tree, ["worktree", "add", "-q", "wt/copy"]);
  const apps = scan(tree).filter((path) => path.endsWith("app.js"));
  assert.deepEqual(apps, ["app.js"]);
});

test("inside a git work tree an untracked file that is not ignored is found", (t) => {
  const tree = repo(t, { "app.js": "export {};\n" }, { "fresh.js": "export {};\n" });
  assert.ok(scan(tree).includes("fresh.js"));
});

test("inside a git work tree a tracked file deleted from disk is left out", (t) => {
  const tree = repo(t, { "app.js": "export {};\n", "gone.js": "export {};\n" }, {});
  rmSync(join(tree, "gone.js"));
  const found = scan(tree).filter((path) => path.endsWith(".js"));
  assert.deepEqual(found, ["app.js"]);
});

test("inside a git work tree a scan rooted in a subdirectory lists paths relative to it", (t) => {
  const tree = repo(t, { "pkg/lib/a.js": "export {};\n", "other.js": "export {};\n" }, {});
  assert.deepEqual(scan(join(tree, "pkg")), ["lib/a.js"]);
});
