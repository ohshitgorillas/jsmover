import { posix } from "node:path";

/** Index file names a bare directory specifier resolves through. */
const INDEX = /^index\.m?js$/;

/**
 * Prefix a relative path so it reads as a relative specifier.
 * @param {string} rel a posix path relative to the importer's directory
 * @returns {string} the path starting with `./` or `../`
 */
function relative(rel) {
  return rel === ".." || rel.startsWith("../") ? rel : `./${rel}`;
}

/**
 * Classify how `text` names its target: the exact file name, the file name without its extension, or a directory.
 * @param {string} text the specifier as written
 * @param {string} resolved the root-relative path `text` resolved to
 * @returns {"exact" | "bare" | "dir"} the shape of `text`
 */
function shapeOf(text, resolved) {
  const last = text.slice(text.lastIndexOf("/") + 1);
  const file = posix.basename(resolved);
  if (last === file) return "exact";
  if (last !== "" && last === file.slice(0, file.length - posix.extname(file).length)) return "bare";
  return "dir";
}

/**
 * The directory specifier naming `targetNew`'s directory from `fromDir`, or null when no named directory reaches it.
 * @param {string} text the specifier as written
 * @param {string} fromDir the importer's directory after the move
 * @param {string} targetNew the target's root-relative path after the move
 * @returns {string | null} the directory specifier, keeping a trailing slash written in `text`
 */
function directorySpecifier(text, fromDir, targetNew) {
  if (!INDEX.test(posix.basename(targetNew))) return null;
  const rel = posix.relative(fromDir, posix.dirname(targetNew));
  const last = rel.slice(rel.lastIndexOf("/") + 1);
  if (last === "" || last === "..") return null;
  return relative(rel) + (text.endsWith("/") ? "/" : "");
}

/**
 * Compute the new specifier text for a site after a move, from the importer's new location to the target's new
 * location, in the same shape as the text written: extension kept or omitted as written, a bare directory kept while
 * the target is an index file in a directory the specifier can name.
 * @param {string} text the specifier as written
 * @param {string} resolved the root-relative path `text` resolved to
 * @param {string} importerNew the importing file's root-relative path after the move
 * @param {string} targetNew the target's root-relative path after the move
 * @returns {string} the replacement specifier text
 */
export function newSpecifier(text, resolved, importerNew, targetNew) {
  const fromDir = posix.dirname(importerNew);
  const file = relative(posix.relative(fromDir, targetNew));
  const shape = shapeOf(text, resolved);
  if (shape === "bare") return file.slice(0, file.length - posix.extname(file).length);
  if (shape === "dir") return directorySpecifier(text, fromDir, targetNew) ?? file;
  return file;
}
