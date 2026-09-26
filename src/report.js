import { posix } from "node:path";
import { resolve } from "./resolve.js";

// A `./` or `../` path standing at the start of a path token, running to the
// next character that cannot sit inside a path.
const RELATIVE = /(?<![\w./-])\.\.?\/[^\s"'`()<>{}[\],;]*/g;

// A character that continues a path segment, so a match followed by one names
// a longer path than the one searched for.
const PATH_CHAR = /[\w.-]/;

/**
 * Order by code unit, independent of locale.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Order records by file, then by line within a file.
 * @param {{ file: string, line: number }} a
 * @param {{ file: string, line: number }} b
 * @returns {number}
 */
function byFileThenLine(a, b) {
  return compare(a.file, b.file) || a.line - b.line;
}

/**
 * Return one line per unresolvable site, ordered by file then line.
 * @param {import("./parse.js").Site[]} sites the unresolvable sites
 * @returns {string[]} one `file:line:` line per site
 */
export function unresolvableLines(sites) {
  return sites.toSorted(byFileThenLine).map((site) => `${site.file}:${site.line}: unresolvable dynamic specifier`);
}

/**
 * Return the dry-run lines for a plan: one per file move, then one per
 * rewrite, then one per unresolvable site, each group ordered by file then line.
 * @param {Pick<import("./plan.js").Plan, "moves" | "rewrites" | "unresolvable">} plan the file moves, rewrites and unresolvable sites of a run
 * @returns {string[]} the plan's lines, in print order
 */
export function planLines(plan) {
  const moves = plan.moves.toSorted((a, b) => compare(a.from, b.from));
  const rewrites = plan.rewrites.toSorted(byFileThenLine);
  return [
    ...moves.map((move) => `move: ${move.from} -> ${move.to}`),
    ...rewrites.map((site) => `${site.file}:${site.line}: ${site.text} -> ${site.replacement}`),
    ...unresolvableLines(plan.unresolvable),
  ];
}

/**
 * Whether `text` holds `path` not followed by more of a path segment.
 * @param {string} text
 * @param {string} path
 * @returns {boolean}
 */
function mentions(text, path) {
  for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
    if (!PATH_CHAR.test(text.charAt(at + path.length))) return true;
  }
  return false;
}

/**
 * Whether a relative path written in `record`'s file names `from` or a file beneath it.
 * @param {import("./parse.js").Text} record the string literal or comment holding the path
 * @param {string} relative a `./` or `../` path
 * @param {string} from the moved path's old location
 * @returns {boolean}
 */
function reaches(record, relative, from) {
  let path = relative;
  while (path.endsWith(".")) path = path.slice(0, -1);
  const target = posix.join(posix.dirname(record.file), path);
  if (target.startsWith(`${from}/`)) return true;
  return resolve({ ...record, text: path }, new Set([from])) === from;
}

/**
 * Whether a string literal or comment still points at the move's old location.
 * @param {import("./plan.js").Move} move
 * @param {import("./parse.js").Text} record
 * @returns {boolean}
 */
function isStale(move, record) {
  if (mentions(record.text, move.from)) return true;
  return [...record.text.matchAll(RELATIVE)].some(([relative]) => reaches(record, relative, move.from));
}

/**
 * Return the advisory lines for string literals and comments that still name
 * the move's old location, either by its root-relative path or by a `./` or
 * `../` path that resolves from their own file to it, ordered by file then line.
 * @param {import("./plan.js").Move} move the move whose old location is searched for
 * @param {import("./parse.js").Text[]} strings string literals that are not rewrite sites
 * @param {import("./parse.js").Text[]} comments comments, each with its body as `text`
 * @returns {string[]} one `file:line: text` line per stale record
 */
export function staleLines(move, strings, comments) {
  return [...strings, ...comments]
    .filter((record) => isStale(move, record))
    .sort(byFileThenLine)
    .map((record) => `${record.file}:${record.line}: ${record.text}`);
}
