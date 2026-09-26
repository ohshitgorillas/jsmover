import { test } from "node:test";
import assert from "node:assert/strict";
import { gitMove, isTracked } from "../src/git.js";
import { fixture, thrown } from "./support/fixture.js";
import { git, repo } from "./support/repo.js";

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
