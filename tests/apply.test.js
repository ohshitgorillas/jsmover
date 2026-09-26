import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { apply } from "../src/apply.js";

/** @typedef {{ file: string, start: number, end: number, text: string, line: number, kind: string, replacement: string }} Rewrite */

const DOM = 'import { util } from "./util.js";\nexport const dom = util;\n';
const APP =
  "import  {x}   from './other.js' ;\n" +
  'import { dom } from "./lib/dom.js";\n' +
  "const lazy = () => import('./lib/dom.js');\n" +
  "export { dom, lazy, x };\n";

/** A tree mixing quote styles, unsorted imports and irregular spacing. */
const FILES = {
  "lib/dom.js": DOM,
  "lib/util.js": "export const util = 1;\n",
  "app.js": APP,
  "other.js": "export const x = 'lib/dom.js';\n",
  "vendor.min.js": "var a=1;import('./lib/util.js');\n",
};

/**
 * A rewrite of the `nth` occurrence of `text` in `source`.
 * @param {string} file
 * @param {string} source
 * @param {[string, number, number, string]} spec text, occurrence, line, replacement
 * @returns {Rewrite}
 */
function rewrite(file, source, [text, nth, line, replacement]) {
  let start = -1;
  for (let seen = 0; seen <= nth; seen++) start = source.indexOf(text, start + 1);
  return { file, start, end: start + text.length, text, line, kind: "import", replacement };
}

const PLAN = {
  moves: [{ from: "lib/dom.js", to: "lib/core/dom.js" }],
  rewrites: [
    rewrite("app.js", APP, ["./lib/dom.js", 0, 2, "./lib/core/dom.js"]),
    rewrite("app.js", APP, ["./lib/dom.js", 1, 3, "./lib/core/dom.js"]),
    rewrite("lib/dom.js", DOM, ["./util.js", 0, 1, "../util.js"]),
  ],
  unresolvable: [],
};
const TEXTS = { "app.js": APP, "lib/dom.js": DOM };

/**
 * A fresh directory holding `files`, removed when the test ends.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files
 */
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "jsmover-apply-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  });
  return root;
}

/**
 * The text at `path` under `root`, or null when nothing is there.
 * @param {string} root
 * @param {string} path
 */
function readOr(root, path) {
  return existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
}

/**
 * The error `fn` throws, or undefined when it returns.
 * @param {() => unknown} fn
 * @returns {unknown}
 */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

/**
 * The tree after applying the shared plan.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files
 */
function applied(t, files) {
  const root = fixture(t, files);
  apply(root, PLAN, TEXTS);
  return root;
}

test("two rewrites in one file each land at the offsets they name", (t) => {
  const root = applied(t, FILES);
  const expected =
    "import  {x}   from './other.js' ;\n" +
    'import { dom } from "./lib/core/dom.js";\n' +
    "const lazy = () => import('./lib/core/dom.js');\n" +
    "export { dom, lazy, x };\n";
  assert.equal(readOr(root, "app.js"), expected);
});

test("only a file holding a rewritten specifier differs from the fixture", (t) => {
  const root = applied(t, FILES);
  const stayed = Object.keys(FILES).filter((path) => path !== "lib/dom.js");
  assert.deepEqual(
    stayed.filter((path) => readOr(root, path) !== FILES[/** @type {keyof typeof FILES} */ (path)]),
    ["app.js"],
  );
});

test("a moved file lands at its destination carrying its own rewrite", (t) => {
  const root = applied(t, FILES);
  assert.equal(readOr(root, "lib/core/dom.js"), 'import { util } from "../util.js";\nexport const dom = util;\n');
});

test("the source path is empty after the move", (t) => {
  const root = applied(t, FILES);
  assert.equal(existsSync(join(root, "lib/dom.js")), false);
});

test("an existing destination refuses the move with DESTINATION_EXISTS", (t) => {
  const root = fixture(t, { ...FILES, "lib/core/dom.js": "export {};\n" });
  const error = /** @type {{ code?: unknown } | undefined} */ (thrown(() => apply(root, PLAN, TEXTS)));
  assert.equal(error?.code, "DESTINATION_EXISTS");
});

test("an existing destination leaves the importer as written where a free one rewrites it", (t) => {
  const refused = fixture(t, { ...FILES, "lib/core/dom.js": "export {};\n" });
  thrown(() => apply(refused, PLAN, TEXTS));
  const free = applied(t, FILES);
  assert.notEqual(readOr(refused, "app.js"), readOr(free, "app.js"));
});

const IMPORTER = 'import { m } from "./m.js";\nexport default m;\n';
const MODULE = "export const m = 1;\n";
const FAILING_PLAN = {
  moves: [{ from: "m.js", to: "lib/m.js" }],
  rewrites: ["a.js", "b.js"].map((file) => rewrite(file, IMPORTER, ["./m.js", 0, 1, "./lib/m.js"])),
  unresolvable: [],
};

/**
 * Apply FAILING_PLAN through a filesystem whose second write leaves an empty
 * file and throws, recording what each operation touched.
 * @param {import("node:test").TestContext} t
 */
function failedRun(t) {
  const root = fixture(t, { "a.js": IMPORTER, "b.js": IMPORTER, "m.js": MODULE });
  const injected = new Error("disk full");
  /** @type {{ root: string, injected: Error, written: string[], moved: string[], made: string[], error?: unknown }} */
  const run = { root, injected, written: [], moved: [], made: [] };
  const outcomes = [false, true];
  const io = {
    /** @type {(path: string, text: string) => void} */
    write(path, text) {
      const fails = outcomes[run.written.length] ?? false;
      run.written.push(relative(root, path));
      writeFileSync(path, fails ? "" : text);
      if (fails) throw injected;
    },
    /** @type {(from: string, to: string) => void} */
    move(from, to) {
      run.moved.push(relative(root, from));
      renameSync(from, to);
    },
    /** @type {(path: string) => void} */
    mkdir(path) {
      run.made.push(relative(root, path));
      mkdirSync(path);
    },
  };
  run.error = thrown(() => apply(root, FAILING_PLAN, { "a.js": IMPORTER, "b.js": IMPORTER }, io));
  return run;
}

test("a failed write rethrows the error the write raised", (t) => {
  const run = failedRun(t);
  assert.equal(run.error, run.injected);
});

test("a file written before the failure holds its original text again", (t) => {
  const run = failedRun(t);
  assert.equal(run.written.length > 0 ? readOr(run.root, run.written[0]) : null, IMPORTER);
});

test("a file whose write failed holds its original text again", (t) => {
  const run = failedRun(t);
  assert.equal(run.written.length > 1 ? readOr(run.root, run.written[1]) : null, IMPORTER);
});

test("a moved source is back at its old path after a failed write", (t) => {
  const run = failedRun(t);
  assert.equal(run.moved.length > 0 ? readOr(run.root, run.moved[0]) : null, MODULE);
});

test("a destination directory the move created is gone after a failed write", (t) => {
  const run = failedRun(t);
  assert.equal(run.made.length > 0 ? existsSync(join(run.root, run.made[0])) : null, false);
});

test("a tracked source moves as a staged rename", (t) => {
  const root = fixture(t, FILES);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const identity = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    [...identity, "commit", "-q", "-m", "fixture"],
  ]) {
    spawnSync("git", args, { cwd: root, env });
  }
  apply(root, PLAN, TEXTS);
  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], { cwd: root, env });
  assert.match(String(status.stdout), /^RM lib\/dom\.js -> lib\/core\/dom\.js$/m);
});
