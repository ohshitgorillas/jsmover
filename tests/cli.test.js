import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../src/cli.js";

const IMPORTER = 'import { a } from "./lib/a.js";\nexport const b = a;\n';
const REWRITTEN = 'import { a } from "./lib/core/a.js";\nexport const b = a;\n';

/** A tree with one importer and no package.json, tsconfig.json or jsconfig.json. */
const BASE = {
  "lib/a.js": "export const a = 1;\n",
  "app.js": IMPORTER,
};
const MOVE = ["mv", "lib/a.js", "lib/core/a.js"];
const DRY_MOVE = [...MOVE, "--dry-run"];

const WIDGET_X = 'import { y } from "./y.js";\nexport const x = y;\n';
/** A directory whose two files import each other, and one importer outside it. */
const WIDGETS = {
  "widgets/x.js": WIDGET_X,
  "widgets/y.js": "export const y = 1;\n",
  "main.js": 'import { x } from "./widgets/x.js";\nexport const z = x;\n',
};

/**
 * A fresh directory holding `files`, removed when the test ends.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files
 * @returns {string}
 */
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "jsmover-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  });
  return root;
}

/**
 * Run the command in `root`, collecting what it prints.
 * @param {string[]} argv
 * @param {string} root
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(argv, root) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const status = main(argv, { write: (chunk) => out.push(chunk) }, { write: (chunk) => err.push(chunk) }, root);
  return { status, stdout: out.join(""), stderr: err.join("") };
}

/**
 * Every file under `root` outside `.git`, mapped to its text.
 * @param {string} root
 * @returns {Record<string, string>}
 */
function snapshot(root) {
  const paths = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => !path.startsWith(".git") && statSync(join(root, path)).isFile())
    .sort();
  return Object.fromEntries(paths.map((path) => [path, readFileSync(join(root, path), "utf8")]));
}

/**
 * Run git in `root` with no inherited repository, user or system configuration.
 * @param {string} root
 * @param {string[]} args
 * @returns {string} git's stdout
 */
function gitIn(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const identity = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];
  const result = spawnSync("git", [...identity, ...args], {
    cwd: root,
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
  });
  return result.stdout;
}

test("a move in a tree with no configuration file exits 0", (t) => {
  assert.equal(run(MOVE, fixture(t, BASE)).status, 0);
});

test("a move in a tree with no configuration file rewrites the importer", (t) => {
  const root = fixture(t, BASE);
  run(MOVE, root);
  assert.equal(readFileSync(join(root, "app.js"), "utf8"), REWRITTEN);
});

test("a syntax error in an unrelated file exits 1", (t) => {
  assert.equal(run(MOVE, fixture(t, { ...BASE, "junk.js": "const ok = 1;\nconst = ;\n" })).status, 1);
});

test("a syntax error in an unrelated file keeps the source where a clean tree moves it", (t) => {
  const broken = fixture(t, { ...BASE, "junk.js": "const ok = 1;\nconst = ;\n" });
  const clean = fixture(t, BASE);
  run(MOVE, broken);
  run(MOVE, clean);
  assert.notEqual(existsSync(join(broken, "lib/a.js")), existsSync(join(clean, "lib/a.js")));
});

test("a syntax error is reported at its file and line", (t) => {
  const { stderr } = run(MOVE, fixture(t, { ...BASE, "junk.js": "const ok = 1;\nconst = ;\n" }));
  assert.match(stderr, /^junk\.js:2:\d+: /);
});

test("an existing destination exits 1", (t) => {
  assert.equal(run(MOVE, fixture(t, { ...BASE, "lib/core/a.js": "export const c = 3;\n" })).status, 1);
});

test("an existing destination leaves the importer as a free destination does not", (t) => {
  const taken = fixture(t, { ...BASE, "lib/core/a.js": "export const c = 3;\n" });
  const free = fixture(t, BASE);
  run(MOVE, taken);
  run(MOVE, free);
  assert.notEqual(readFileSync(join(taken, "app.js"), "utf8"), readFileSync(join(free, "app.js"), "utf8"));
});

test("a dry run onto an existing destination exits 1 where a free one exits 0", (t) => {
  const taken = run(DRY_MOVE, fixture(t, { ...BASE, "lib/core/a.js": "export const c = 3;\n" })).status;
  assert.deepEqual([taken, run(DRY_MOVE, fixture(t, BASE)).status], [1, 0]);
});

test("a directory move onto an existing directory exits 1 where a free one exits 0", (t) => {
  const taken = run(["mv", "widgets", "ui"], fixture(t, { ...WIDGETS, "ui/z.js": "export const w = 0;\n" })).status;
  assert.deepEqual([taken, run(["mv", "widgets", "ui"], fixture(t, WIDGETS)).status], [1, 0]);
});

test("a directory move onto an existing directory leaves the tree unchanged", (t) => {
  const files = { ...WIDGETS, "ui/z.js": "export const w = 0;\n" };
  const root = fixture(t, files);
  run(["mv", "widgets", "ui"], root);
  assert.deepEqual(snapshot(root), files);
});

test("a specifier matching two files exits 1", (t) => {
  const root = fixture(t, { "x.js": "", "x.mjs": "", "app.js": 'import "./x";\n' });
  assert.equal(run(["mv", "x.js", "y.js"], root).status, 1);
});

test("no subcommand exits with usage status 2", (t) => {
  assert.equal(run([], fixture(t, BASE)).status, 2);
});

test("mv with one path exits with usage status 2", (t) => {
  assert.equal(run(["mv", "lib/a.js"], fixture(t, BASE)).status, 2);
});

test("an unknown option exits with usage status 2", (t) => {
  assert.equal(run([...MOVE, "--force"], fixture(t, BASE)).status, 2);
});

test("a missing source exits with usage status 2", (t) => {
  assert.equal(run(["mv", "lib/none.js", "lib/core/none.js"], fixture(t, BASE)).status, 2);
});

test("a dry run leaves every file byte-identical", (t) => {
  const root = fixture(t, BASE);
  run(DRY_MOVE, root);
  assert.deepEqual(snapshot(root), BASE);
});

test("a dry run prints the importer's new specifier", (t) => {
  assert.match(run(DRY_MOVE, fixture(t, BASE)).stdout, /\.\/lib\/core\/a\.js/);
});

test("a dry run prints what a real run on a copy of the tree prints", (t) => {
  const dry = run(DRY_MOVE, fixture(t, BASE)).stdout;
  assert.equal(dry, run(MOVE, fixture(t, BASE)).stdout);
});

test("a directory move rewrites the importer outside it", (t) => {
  const root = fixture(t, WIDGETS);
  run(["mv", "widgets", "ui/widgets"], root);
  assert.equal(
    readFileSync(join(root, "main.js"), "utf8"),
    'import { x } from "./ui/widgets/x.js";\nexport const z = x;\n',
  );
});

test("a directory move carries its files with their internal specifiers as written", (t) => {
  const root = fixture(t, WIDGETS);
  run(["mv", "widgets", "ui/widgets"], root);
  assert.equal(snapshot(root)["ui/widgets/x.js"], WIDGET_X);
});

test("a string literal naming the old path is reported at its file and line", (t) => {
  const root = fixture(t, { ...BASE, "table.js": 'export const at = 1;\nexport const where = "lib/a.js";\n' });
  assert.match(run(MOVE, root).stderr, /^table\.js:2: /m);
});

test("a non-literal import() is reported at its file and line", (t) => {
  const root = fixture(t, { ...BASE, "lazy.js": "\nexport const load = (name) => import(name);\n" });
  assert.match(run(MOVE, root).stderr, /^lazy\.js:2: /m);
});

test("a tracked source moved inside a repository is staged as a rename", (t) => {
  const root = fixture(t, BASE);
  gitIn(root, ["init", "-q"]);
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "fixture"]);
  run(MOVE, root);
  assert.match(gitIn(root, ["diff", "--cached", "-M", "--name-status"]), /^R\d+\tlib\/a\.js\tlib\/core\/a\.js$/m);
});
