import { lstatSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { isWorkTree, listedFiles } from "./git.js";

const SKIPPED = new Set(["node_modules", ".git"]);
const SOURCE = /\.(?:js|mjs|cjs)$/;

/**
 * Whether a file is JavaScript source to parse: a `.js`, `.mjs` or `.cjs` file.
 * @param {string} file a path or file name
 * @returns {boolean}
 */
export function isSource(file) {
  return SOURCE.test(file);
}

/**
 * Every file under a tree outside a git work tree, leaving out anything
 * beneath a `node_modules` or `.git` directory.
 * @param {string} root directory to walk
 * @returns {string[]} root-relative paths with `/` separators
 */
function walk(root) {
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const pending = [""];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) pending.push(rel);
      } else if (entry.isFile()) {
        found.push(rel);
      }
    }
  }
  return found;
}

/**
 * Whether `path` under `root` is a regular file on disk.
 * @param {string} root
 * @param {string} path
 * @returns {boolean}
 */
function isFileOnDisk(root, path) {
  return lstatSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * List every file under a tree. Inside a git work tree that is each file git
 * tracks or would track, present on disk; elsewhere it is every file outside
 * a `node_modules` or `.git` directory.
 * @param {string} root directory to list
 * @returns {string[]} root-relative paths with `/` separators, sorted
 */
export function scan(root) {
  if (!isWorkTree(root)) return walk(root).sort();
  const listed = new Set(listedFiles(root));
  return [...listed].filter((path) => isFileOnDisk(root, path)).sort();
}
