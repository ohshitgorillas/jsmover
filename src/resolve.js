import { posix } from "node:path";

/**
 * @typedef {{ file: string, start: number, end: number, text: string, line: number, kind: string }} Site
 */

const PROBES = [".js", ".mjs", ".cjs", ".json", "/index.js", "/index.mjs"];

/**
 * Thrown when a specifier matches more than one probed file.
 */
export class AmbiguousSpecifier extends Error {
  /**
   * Record the site and the files it could name.
   * @param {Site} site the specifier site that matched more than once
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
 * Map a specifier site to the root-relative path of the file it names: the
 * exact path when that file exists, otherwise the single probed candidate.
 * @param {Site} site the specifier site
 * @param {Set<string>} files root-relative paths of the tree's files
 * @returns {string | null} the named file, or null for a non-relative specifier or no match
 */
export function resolve(site, files) {
  if (!site.text.startsWith("./") && !site.text.startsWith("../")) return null;
  const target = posix.join(posix.dirname(site.file), site.text);
  if (files.has(target)) return target;
  const candidates = PROBES.map((probe) => target + probe).filter((path) => files.has(path));
  if (candidates.length > 1) throw new AmbiguousSpecifier(site, candidates);
  return candidates[0] ?? null;
}
