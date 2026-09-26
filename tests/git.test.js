import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitMove, isTracked } from "../src/git.js";
import { fixture, thrown } from "./support/fixture.js";

const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...inherited } = process.env;
const GIT_ENV = {
  ...inherited,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

/**
 * Run git in `cwd` with no user or system configuration.
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

/**
 * A repository with `committed` in its first commit and `loose` left untracked.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} committed
 * @param {Record<string, string>} loose
 */
function repo(t, committed, loose) {
  const root = fixture(t, committed);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  for (const [path, text] of Object.entries(loose)) writeFileSync(join(root, path), text);
  return root;
}

test("a committed file reads as tracked", (t) => {
  const root = repo(t, { "a.js": "export const a = 1;\n" }, {});
  assert.equal(isTracked(root, "a.js"), true);
});

test("an untracked file reads differently from a committed one in the same repository", (t) => {
  const root = repo(t, { "a.js": "export const a = 1;\n" }, { "b.js": "export const b = 2;\n" });
  assert.notEqual(isTracked(root, "b.js"), isTracked(root, "a.js"));
});

test("a file outside any work tree reads differently from the same file committed", (t) => {
  const files = { "a.js": "export const a = 1;\n" };
  const plain = fixture(t, files);
  const root = repo(t, files, {});
  assert.notEqual(isTracked(plain, "a.js"), isTracked(root, "a.js"));
});

test("a move of a committed file is staged as a rename", (t) => {
  const root = repo(t, { "a.js": "export const a = 1;\n", "lib/keep.js": "export {};\n" }, {});
  gitMove(root, "a.js", "lib/a.js");
  assert.equal(git(root, ["status", "--porcelain=v1"]).stdout, "R  a.js -> lib/a.js\n");
});

test("a failed move carries the exit status git gave", (t) => {
  const root = repo(t, { "a.js": "export const a = 1;\n" }, {});
  const direct = git(root, ["mv", "missing.js", "gone.js"]);
  const error = /** @type {{ status?: unknown } | undefined} */ (thrown(() => gitMove(root, "missing.js", "gone.js")));
  assert.equal(error?.status, direct.status);
});

test("a failed move carries the text git wrote to stderr", (t) => {
  const root = repo(t, { "a.js": "export const a = 1;\n" }, {});
  const direct = git(root, ["mv", "missing.js", "gone.js"]);
  const error = /** @type {{ stderr?: unknown } | undefined} */ (thrown(() => gitMove(root, "missing.js", "gone.js")));
  assert.equal(error?.stderr, direct.stderr);
});
