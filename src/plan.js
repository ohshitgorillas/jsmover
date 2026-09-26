import { resolve } from "./resolve.js";
import { newSpecifier } from "./specifier.js";

/** @typedef {{ from: string, to: string }} Move */
/** @typedef {import("./parse.js").Site & { replacement: string }} Rewrite */
/**
 * @typedef {object} Plan
 * @property {Move} move the one physical move asked for, of a file or a directory
 * @property {Move[]} moves one per file the move takes
 * @property {Rewrite[]} rewrites
 * @property {import("./parse.js").Site[]} unresolvable
 */

/**
 * One move per file the move takes: the file itself, or every file beneath the directory.
 * @param {Move} move root-relative source and destination
 * @param {Set<string>} files root-relative paths of the tree's files
 * @returns {Move[]}
 */
function expand(move, files) {
  if (files.has(move.from)) return [move];
  const prefix = `${move.from}/`;
  return [...files]
    .filter((file) => file.startsWith(prefix))
    .map((file) => ({ from: file, to: move.to + file.slice(move.from.length) }));
}

/**
 * The rewrite a site needs after the moves, or null when its text stays as written.
 * @param {import("./parse.js").Site} site the specifier site
 * @param {Set<string>} files root-relative paths of the tree's files
 * @param {Map<string, string>} moved each moved file's new path, keyed by its old path
 * @returns {Rewrite | null}
 */
function rewriteOf(site, files, moved) {
  const target = resolve(site, files);
  if (target === null || target === site.file) return null;
  if (!moved.has(target) && !moved.has(site.file)) return null;
  const replacement = newSpecifier(site.text, target, moved.get(site.file) ?? site.file, moved.get(target) ?? target);
  return replacement === site.text ? null : { ...site, replacement };
}

/**
 * Turn a move of a file or a directory into the file moves it takes and the
 * specifier rewrites they need: every site resolving to a moved file, and
 * every site inside one, recomputed from both ends' new paths. A site
 * resolving to its own file stays as written.
 * @param {Move} move root-relative source and destination, naming a file or a directory
 * @param {Set<string>} files root-relative paths of the tree's files
 * @param {Map<string, { sites: import("./parse.js").Site[], unresolvable: import("./parse.js").Site[] }>} sitesByFile each parsed file's sites
 * @returns {Plan} the move, its per-file moves, the rewrites, and every unresolvable site in the tree
 * @throws {import("./resolve.js").AmbiguousSpecifier} when a specifier matches more than one file
 */
export function plan(move, files, sitesByFile) {
  const moves = expand(move, files);
  const moved = new Map(moves.map((m) => [m.from, m.to]));
  /** @type {Rewrite[]} */
  const rewrites = [];
  /** @type {import("./parse.js").Site[]} */
  const unresolvable = [];
  for (const parsed of sitesByFile.values()) {
    unresolvable.push(...parsed.unresolvable);
    for (const site of parsed.sites) {
      const rewrite = rewriteOf(site, files, moved);
      if (rewrite) rewrites.push(rewrite);
    }
  }
  return { move, moves, rewrites, unresolvable };
}
