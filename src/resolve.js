import { posix } from "node:path";

/** @typedef {{ file: string, text: string, line: number }} Named */

const PROBES = [".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs"];

/**
 * Thrown when a specifier matches more than one probed file.
 */
export class AmbiguousSpecifier extends Error {
  /**
   * Carry the record and the files it could name.
   * @param {Named} site the record whose text matched more than once
   * @param {string[]} candidates root-relative paths of every matching file
   */
  constructor(site, candidates) {
    super(`${site.file}:${site.line}: "${site.text}" matches ${candidates.join(", ")}`);
    this.name = "AmbiguousSpecifier";
    this.site = site;
    this.candidates = candidates;
  }
}

/**
 * Map a relative path written in a file to the root-relative path of the file
 * it names: the exact path when that file exists, otherwise the single probed
 * candidate.
 * @param {Named} record any record carrying the path as `text`, the file holding it and its line
 * @param {Set<string>} files root-relative paths of the tree's files
 * @returns {string | null} the named file, or null for a non-relative path or no match
 */
export function resolve(record, files) {
  if (!record.text.startsWith("./") && !record.text.startsWith("../")) return null;
  const target = posix.join(posix.dirname(record.file), record.text);
  if (files.has(target)) return target;
  const candidates = PROBES.map((probe) => target + probe).filter((path) => files.has(path));
  if (candidates.length > 1) throw new AmbiguousSpecifier(record, candidates);
  return candidates[0] ?? null;
}
