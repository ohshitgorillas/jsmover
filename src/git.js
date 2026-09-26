import { spawnSync } from "node:child_process";

/**
 * Run git in `root`. Inherited variables that point git at another repository
 * or index are dropped, so the command always acts on the tree at `root`.
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...env } = process.env;
  return spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
}

/**
 * Whether `path` is tracked by git in the work tree at `root`.
 * @param {string} root directory git runs in
 * @param {string} path the path to look up, relative to `root` or absolute
 * @returns {boolean} true when `root` is inside a work tree and git tracks `path`
 */
export function isTracked(root, path) {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]).status !== 0) return false;
  return git(root, ["ls-files", "--error-unmatch", "--", path]).status === 0;
}

/**
 * Move `from` to `to` with `git mv`.
 * @param {string} root directory git runs in
 * @param {string} from the tracked source path
 * @param {string} to the destination path
 * @returns {void}
 * @throws {Error & { status: number | null, stderr: string }} when git mv fails,
 *   carrying git's exit status and its stderr text
 */
export function gitMove(root, from, to) {
  const result = git(root, ["mv", from, to]);
  if (result.status === 0) return;
  const stderr = result.stderr ?? "";
  const message = stderr.trim() || `git mv exited with status ${result.status}`;
  throw Object.assign(new Error(message), { status: result.status, stderr });
}
