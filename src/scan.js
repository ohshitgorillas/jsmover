import { readdirSync } from "node:fs";
import { join, posix } from "node:path";

const SKIPPED = new Set(["node_modules", ".git"]);
const SCANNED = /\.(?:js|mjs|cjs)$/;

/**
 * List every `.js`, `.mjs` and `.cjs` file under a tree, leaving out anything
 * beneath a `node_modules` or `.git` directory.
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
      } else if (entry.isFile() && SCANNED.test(entry.name)) {
        found.push(rel);
      }
    }
  }
  return found.sort();
}
