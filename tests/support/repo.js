import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./fixture.js";

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
export function git(cwd, args) {
  return spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

/**
 * A repository with `committed` in its first commit and `loose` left untracked.
 * @param {{ after(fn: () => void): unknown }} t a test context, or node:test's `after` hook wrapped as one
 * @param {Record<string, string>} committed
 * @param {Record<string, string>} loose
 * @returns {string} the repository's absolute path
 */
export function repo(t, committed, loose) {
  const root = fixture(t, committed);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  for (const [path, text] of Object.entries(loose)) writeFileSync(join(root, path), text);
  return root;
}
