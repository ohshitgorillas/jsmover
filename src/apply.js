import fs from "node:fs";
import path from "node:path";
import { gitMove, isTracked } from "./git.js";

/** @typedef {{ file: string, start: number, end: number, text: string, line: number, kind: string }} Site */
/** @typedef {{ from: string, to: string }} Move */
/** @typedef {Site & { replacement: string }} Rewrite */
/** @typedef {{ moves: Move[], rewrites: Rewrite[], unresolvable: Site[] }} Plan */

/**
 * The filesystem operations apply performs. Every path is absolute.
 * @typedef {object} Io
 * @property {(file: string) => string} read
 * @property {(file: string, text: string) => void} write
 * @property {(dir: string) => void} mkdir creates one directory whose parent exists
 * @property {(from: string, to: string) => void} rename
 * @property {(file: string) => boolean} exists
 * @property {(dir: string) => void} rmdirIfEmpty
 * @property {(from: string, to: string) => void} move
 */

/**
 * @param {string} dir
 */
function rmdirIfEmpty(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * `io` with every missing operation taken from node:fs. The default move is a
 * `git mv` for a tracked source and a rename otherwise.
 * @param {string} root
 * @param {Partial<Io>} io
 * @returns {Io}
 */
function withDefaults(root, io) {
  const rename = io.rename ?? ((from, to) => fs.renameSync(from, to));
  return {
    read: (file) => fs.readFileSync(file, "utf8"),
    write: (file, text) => fs.writeFileSync(file, text),
    mkdir: (dir) => fs.mkdirSync(dir),
    exists: (file) => fs.existsSync(file),
    rmdirIfEmpty,
    move: (from, to) => (isTracked(root, from) ? gitMove(root, from, to) : rename(from, to)),
    ...io,
    rename,
  };
}

/**
 * The root-relative path `file` has once `moves` are done.
 * @param {string} file
 * @param {Move[]} moves
 */
function afterMoves(file, moves) {
  return moves.find((move) => move.from === file)?.to ?? file;
}

/**
 * Every rewritten file's new body, keyed by its path before the moves.
 * Splices run from the highest offset down, so each earlier offset still
 * names the original text.
 * @param {Rewrite[]} rewrites
 * @param {Record<string, string>} texts
 * @returns {Map<string, string>}
 */
function newBodies(rewrites, texts) {
  const bodies = new Map();
  const ordered = [...rewrites].sort((a, b) => b.start - a.start);
  for (const { file, start, end, replacement } of ordered) {
    const body = bodies.get(file) ?? texts[file];
    bodies.set(file, body.slice(0, start) + replacement + body.slice(end));
  }
  return bodies;
}

/**
 * The directories missing above each destination, every parent before its
 * children.
 * @param {string} root
 * @param {Move[]} moves
 * @param {Io} io
 * @returns {string[]}
 */
function missingDirs(root, moves, io) {
  /** @type {string[]} */
  const dirs = [];
  for (const { to } of moves) {
    /** @type {string[]} */
    const chain = [];
    let dir = path.dirname(to);
    while (dir !== "." && !dirs.includes(dir) && !io.exists(path.join(root, dir))) {
      chain.unshift(dir);
      dir = path.dirname(dir);
    }
    dirs.push(...chain);
  }
  return dirs;
}

/**
 * @typedef {object} Done
 * @property {string[]} dirs directories created, in creation order
 * @property {Move[]} moved moves performed, in order
 * @property {{ file: string, target: string }[]} written each file written, by its original and current path
 */

/**
 * Undo everything recorded in `done`, continuing past any step that fails.
 * @param {string} root
 * @param {Done} done
 * @param {Record<string, string>} texts
 * @param {Io} io
 */
function rollback(root, done, texts, io) {
  const at = (/** @type {string} */ file) => path.join(root, file);
  const steps = [
    ...done.written.map(
      ({ file, target }) =>
        () =>
          io.write(at(target), texts[file]),
    ),
    ...done.moved.toReversed().map(
      ({ from, to }) =>
        () =>
          io.move(at(to), at(from)),
    ),
    ...done.dirs.toReversed().map((dir) => () => io.rmdirIfEmpty(at(dir))),
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      continue;
    }
  }
}

/**
 * Apply a plan's moves and rewrites to the tree at `root`. Every new body is
 * computed before the first change; an existing destination refuses the plan
 * before any change; any error after the first change restores every written
 * file from `texts`, moves every moved path back and removes each directory
 * created for a destination that is left empty, then is rethrown.
 * @param {string} root absolute path of the tree
 * @param {Plan} plan the moves and rewrites, with root-relative paths; a
 *   rewrite's `file` is the path before the moves
 * @param {Record<string, string>} texts original text of each rewritten file, by its path before the moves
 * @param {Partial<Io>} [io] filesystem operations; each one missing is taken from node:fs
 * @returns {void}
 * @throws {Error & { code: "DESTINATION_EXISTS", path: string }} when a destination exists
 */
export function apply(root, plan, texts, io = {}) {
  const ops = withDefaults(root, io);
  const at = (/** @type {string} */ file) => path.join(root, file);
  const bodies = newBodies(plan.rewrites, texts);
  const taken = plan.moves.find((move) => ops.exists(at(move.to)));
  if (taken) {
    throw Object.assign(new Error(`destination exists: ${taken.to}`), { code: "DESTINATION_EXISTS", path: taken.to });
  }
  /** @type {Done} */
  const done = { dirs: [], moved: [], written: [] };
  try {
    for (const dir of missingDirs(root, plan.moves, ops)) {
      done.dirs.push(dir);
      ops.mkdir(at(dir));
    }
    for (const move of plan.moves) {
      ops.move(at(move.from), at(move.to));
      done.moved.push(move);
    }
    for (const [file, body] of bodies) {
      const target = afterMoves(file, plan.moves);
      done.written.push({ file, target });
      ops.write(at(target), body);
    }
  } catch (error) {
    rollback(root, done, texts, ops);
    throw error;
  }
}
