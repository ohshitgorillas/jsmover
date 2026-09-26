import fs from "node:fs";
import path from "node:path";
import { gitMove, isTracked } from "./git.js";

/**
 * The filesystem operations apply performs. Every path is absolute.
 * @typedef {object} Io
 * @property {(file: string) => string} read
 * @property {(file: string, text: string) => void} write
 * @property {(dir: string) => void} mkdir creates one directory whose parent exists
 * @property {(from: string, to: string) => void} rename
 * @property {(file: string) => boolean} exists
 * @property {(dir: string) => void} rmdirIfEmpty
 * @property {(from: string, to: string) => void} move moves a file or a whole directory
 */

/** Refuses a move whose destination already exists. */
export class DestinationExists extends Error {
  /**
   * Carry the taken destination.
   * @param {string} taken root-relative path of the existing destination
   */
  constructor(taken) {
    super(`destination exists: ${taken}`);
    this.name = "DestinationExists";
    this.code = "DESTINATION_EXISTS";
    this.path = taken;
  }
}

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
 * Every rewritten file's new body, keyed by its path before the move.
 * Splices run from the highest offset down, so each earlier offset still
 * names the original text.
 * @param {import("./plan.js").Rewrite[]} rewrites
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
 * The directories missing above a destination, every parent before its
 * children.
 * @param {string} root
 * @param {string} to root-relative destination
 * @param {Io} io
 * @returns {string[]}
 */
function missingDirs(root, to, io) {
  /** @type {string[]} */
  const dirs = [];
  for (let dir = path.dirname(to); dir !== "." && !io.exists(path.join(root, dir)); dir = path.dirname(dir)) {
    dirs.unshift(dir);
  }
  return dirs;
}

/**
 * @typedef {object} Done
 * @property {string[]} dirs directories created, in creation order
 * @property {import("./plan.js").Move[]} moved the move, once performed
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
    ...done.moved.map(
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
 * Return the plan's destination when something already exists there.
 * @param {string} root absolute path of the tree
 * @param {import("./plan.js").Plan} plan the plan whose `move.to` is checked
 * @param {Partial<Io>} [io] filesystem operations; a missing `exists` is taken from node:fs
 * @returns {string | null} the root-relative destination when it exists, null when it is free
 */
export function takenDestination(root, plan, io = {}) {
  const exists = io.exists ?? fs.existsSync;
  return exists(path.join(root, plan.move.to)) ? plan.move.to : null;
}

/**
 * Apply a plan's move and rewrites to the tree at `root`. Every new body is
 * computed before the first change; an existing destination refuses the plan
 * before any change. The move is one `io.move` of `plan.move`, after creating
 * the destination's missing parents; each rewritten file is then written at
 * its path after the move. Any error after the first change restores every
 * written file from `texts`, moves the source back and removes each directory
 * created for the destination that is left empty, then is rethrown.
 * @param {string} root absolute path of the tree
 * @param {import("./plan.js").Plan} plan the move, per-file moves and rewrites,
 *   with root-relative paths; a rewrite's `file` is the path before the move
 * @param {Record<string, string>} texts original text of each rewritten file, by its path before the move
 * @param {Partial<Io>} [io] filesystem operations; each one missing is taken from node:fs
 * @returns {void}
 * @throws {DestinationExists} when the destination exists
 */
export function apply(root, plan, texts, io = {}) {
  const ops = withDefaults(root, io);
  const at = (/** @type {string} */ file) => path.join(root, file);
  const bodies = newBodies(plan.rewrites, texts);
  const taken = takenDestination(root, plan, ops);
  if (taken !== null) throw new DestinationExists(taken);
  const moved = new Map(plan.moves.map((move) => [move.from, move.to]));
  /** @type {Done} */
  const done = { dirs: [], moved: [], written: [] };
  try {
    for (const dir of missingDirs(root, plan.move.to, ops)) {
      done.dirs.push(dir);
      ops.mkdir(at(dir));
    }
    ops.move(at(plan.move.from), at(plan.move.to));
    done.moved.push(plan.move);
    for (const [file, body] of bodies) {
      const target = moved.get(file) ?? file;
      done.written.push({ file, target });
      ops.write(at(target), body);
    }
  } catch (error) {
    rollback(root, done, texts, ops);
    throw error;
  }
}
