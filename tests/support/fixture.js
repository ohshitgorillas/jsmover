import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A fresh directory holding `files`, removed when `t` runs its after hooks.
 * @param {{ after(fn: () => void): unknown }} t a test context, or node:test's `after` hook wrapped as one
 * @param {Record<string, string>} files each file's text, keyed by its root-relative path
 * @returns {string} the directory's absolute path
 */
export function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "jsmover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/**
 * The error `fn` throws, or undefined when it returns.
 * @param {() => unknown} fn
 * @returns {unknown}
 */
export function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}
