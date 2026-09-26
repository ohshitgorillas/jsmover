import { readdirSync } from "node:fs";
import { join, posix } from "node:path";

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
 * List every file under a tree, leaving out anything beneath a `node_modules`
 * or `.git` directory.
 * @param {string} root directory to walk
 * @returns {string[]} root-relative paths with `/` separators, sorted
 */
export function scan(root) {
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
  return found.sort();
}
