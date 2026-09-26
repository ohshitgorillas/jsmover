import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { apply } from "./apply.js";
import { parse, ParseError } from "./parse.js";
import { plan } from "./plan.js";
import { AmbiguousSpecifier } from "./resolve.js";
import { planLines, staleLines } from "./report.js";
import { scan } from "./scan.js";

const USAGE = "usage: jsmover mv [--dry-run] <old> <new>\n";
const DRY_RUN = "--dry-run";

/** @typedef {{ write(chunk: string): unknown }} Out */
/** @typedef {import("./apply.js").Plan} Plan */
/** @typedef {{ file: string, start: number, end: number, text: string, line: number }} Text */
/** @typedef {{ from: string, to: string, dryRun: boolean }} Command */

/**
 * `file` as a root-relative path with `/` separators.
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
function rootRelative(root, file) {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
}

/**
 * The move an argument list asks for, or null when it is not `mv <old> <new>`
 * with at most the `--dry-run` option.
 * @param {string[]} argv
 * @param {string} root
 * @returns {Command | null}
 */
function command(argv, root) {
  const [verb, ...rest] = argv;
  const paths = rest.filter((arg) => arg !== DRY_RUN);
  if (verb !== "mv" || paths.length !== 2 || paths.some((arg) => arg.startsWith("-"))) return null;
  const [from, to] = paths.map((file) => rootRelative(root, file));
  return { from, to, dryRun: paths.length < rest.length };
}

/**
 * @param {Out} out
 * @param {string[]} lines
 */
function print(out, lines) {
  for (const line of lines) out.write(`${line}\n`);
}

/**
 * Read and parse every scanned file under `root`, then plan the move. Nothing
 * is written.
 * @param {string} root
 * @param {{ from: string, to: string }} move
 * @returns {{ texts: Record<string, string>, strings: Text[], comments: Text[], plan: Plan }}
 * @throws {ParseError} when a file fails to parse
 * @throws {AmbiguousSpecifier} when a specifier matches more than one file
 */
function prepare(root, move) {
  const files = scan(root);
  /** @type {Record<string, string>} */
  const texts = {};
  /** @type {Text[]} */
  const strings = [];
  /** @type {Text[]} */
  const comments = [];
  const sitesByFile = new Map();
  for (const file of files) {
    texts[file] = readFileSync(path.join(root, file), "utf8");
    const parsed = parse(file, texts[file]);
    sitesByFile.set(file, parsed);
    strings.push(...parsed.strings);
    comments.push(...parsed.comments);
  }
  return { texts, strings, comments, plan: plan(move, new Set(files), sitesByFile) };
}

/**
 * The message of an error that refuses the move before any change, rethrowing
 * any other.
 * @param {unknown} error
 * @returns {string}
 */
function refusal(error) {
  if (error instanceof ParseError || error instanceof AmbiguousSpecifier) return error.message;
  throw error;
}

/**
 * Run `jsmover mv <old> <new> [--dry-run]` against the tree at `cwd`: print the
 * plan to `stdout`, apply it unless the run is dry, then print the stale
 * literals and unresolvable specifiers to `stderr`.
 * @param {string[]} argv arguments after the program name
 * @param {Out} stdout where the plan is written
 * @param {Out} stderr where usage, errors and advisories are written
 * @param {string} cwd root of the tree; the paths in `argv` are relative to it
 * @returns {number} 0 when the move applied or a dry run planned it, 1 when it
 *   was refused or failed with the tree unchanged, 2 for a usage error
 */
export function main(argv, stdout, stderr, cwd) {
  const cmd = command(argv, cwd);
  if (!cmd || !existsSync(path.join(cwd, cmd.from))) {
    stderr.write(USAGE);
    return 2;
  }
  if (existsSync(path.join(cwd, cmd.to))) {
    print(stderr, [`destination exists: ${cmd.to}`]);
    return 1;
  }
  const move = { from: cmd.from, to: cmd.to };
  let prepared;
  try {
    prepared = prepare(cwd, move);
  } catch (error) {
    print(stderr, [refusal(error)]);
    return 1;
  }
  print(stdout, planLines(prepared.plan));
  if (!cmd.dryRun) {
    try {
      apply(cwd, prepared.plan, prepared.texts);
    } catch (error) {
      print(stderr, [error instanceof Error ? error.message : String(error)]);
      return 1;
    }
  }
  print(stderr, staleLines(move, prepared.strings, prepared.comments));
  print(stderr, planLines({ moves: [], rewrites: [], unresolvable: prepared.plan.unresolvable }));
  return 0;
}
