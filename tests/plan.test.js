import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parse.js";
import { AmbiguousSpecifier } from "../src/resolve.js";
import { plan } from "../src/plan.js";
import { isSource } from "../src/scan.js";

/**
 * The plan for `move` over a tree whose files hold `sources`, parsing only its source files.
 * @param {{ from: string, to: string }} move root-relative source and destination
 * @param {Record<string, string>} sources each file's text, keyed by its root-relative path
 * @returns {import("../src/plan.js").Plan}
 */
function planFor(move, sources) {
  const files = new Set(Object.keys(sources));
  const parsed = Object.entries(sources).filter(([file]) => isSource(file));
  const sitesByFile = new Map(parsed.map(([file, text]) => [file, parse(file, text)]));
  return plan(move, files, sitesByFile);
}

/**
 * Every specifier in `file` as it reads once the plan's rewrites are applied, in source order.
 * @param {{ from: string, to: string }} move root-relative source and destination
 * @param {Record<string, string>} sources each file's text, keyed by its root-relative path
 * @param {string} file the file whose specifiers are read
 * @returns {string[]}
 */
function after(move, sources, file) {
  const { rewrites } = planFor(move, sources);
  return parse(file, sources[file]).sites.map(
    (site) => rewrites.find((r) => r.file === file && r.start === site.start)?.replacement ?? site.text,
  );
}

const LEAF = "export const x = 1;\n";

const SINGLE = {
  "lib/dom.js": LEAF,
  "lib/coerce.js": 'import { x } from "./dom.js";\nexport const y = x;\n',
  "store/state.js": 'import { y } from "../lib/coerce.js";\nexport const z = y;\n',
};
const SINGLE_MOVE = { from: "lib/coerce.js", to: "lib/core/coerce.js" };

test("a single-file move is one move from the source to the destination", () => {
  assert.deepEqual(planFor(SINGLE_MOVE, SINGLE).moves, [SINGLE_MOVE]);
});

test("an importer of a moved file follows it to its new path", () => {
  assert.deepEqual(after(SINGLE_MOVE, SINGLE, "store/state.js"), ["../lib/core/coerce.js"]);
});

test("a moved file's own import of a file left in place is recomputed from its new directory", () => {
  assert.deepEqual(after(SINGLE_MOVE, SINGLE, "lib/coerce.js"), ["../dom.js"]);
});

test("a rewrite spans the specifier's contents in the importing file", () => {
  const { rewrites } = planFor(SINGLE_MOVE, SINGLE);
  const at = SINGLE["store/state.js"].indexOf("../lib/coerce.js");
  assert.deepEqual(
    rewrites.filter((r) => r.file === "store/state.js").map((r) => [r.start, r.end]),
    [[at, at + "../lib/coerce.js".length]],
  );
});

const DIR = {
  "lib/dom.js": LEAF,
  "components/narrowbar/facettip.js": LEAF,
  "components/narrowbar/bar.js": 'import { x } from "./facettip.js";\nimport { x as d } from "../../lib/dom.js";\n',
  "components/binder.js": 'import { x } from "./narrowbar/facettip.js";\n',
  "components/narrowbarx.js": 'import { x } from "./narrowbar/bar.js";\n',
};
const DIR_MOVE = { from: "components/narrowbar", to: "components/ui/narrow" };

test("a directory move moves every file beneath it and no file beside it", () => {
  assert.deepEqual(
    planFor(DIR_MOVE, DIR)
      .moves.map((m) => [m.from, m.to])
      .sort(),
    [
      ["components/narrowbar/bar.js", "components/ui/narrow/bar.js"],
      ["components/narrowbar/facettip.js", "components/ui/narrow/facettip.js"],
    ],
  );
});

test("a directory move keeps the requested move whole beside its per-file moves", () => {
  assert.deepEqual(planFor(DIR_MOVE, DIR).move, DIR_MOVE);
});

test("a ./data.json import follows the moved data file", () => {
  const sources = {
    "lib/data.json": '{ "n": 1 }\n',
    "lib/app.js": 'import data from "./data.json";\nexport default data;\n',
  };
  const move = { from: "lib/data.json", to: "lib/cfg/data.json" };
  assert.deepEqual(after(move, sources, "lib/app.js"), ["./cfg/data.json"]);
});

test("a directory move keeps the specifier between two moved files and rewrites the one leaving the directory", () => {
  assert.deepEqual(after(DIR_MOVE, DIR, "components/narrowbar/bar.js"), ["./facettip.js", "../../../lib/dom.js"]);
});

test("an importer outside a moved directory follows the file into its new directory", () => {
  assert.deepEqual(after(DIR_MOVE, DIR, "components/binder.js"), ["./ui/narrow/facettip.js"]);
});

test("a directory move emits a rewrite only for a specifier whose text changes", () => {
  assert.deepEqual(
    planFor(DIR_MOVE, DIR)
      .rewrites.map((r) => [r.file, r.text, r.replacement])
      .sort(),
    [
      ["components/binder.js", "./narrowbar/facettip.js", "./ui/narrow/facettip.js"],
      ["components/narrowbar/bar.js", "../../lib/dom.js", "../../../lib/dom.js"],
      ["components/narrowbarx.js", "./narrowbar/bar.js", "./ui/narrow/bar.js"],
    ],
  );
});

test("dir/index.js and bare directory specifiers keep their form across a directory move", () => {
  const sources = {
    "components/narrowbar/index.js": LEAF,
    "components/binder.js": 'import { x } from "./narrowbar/index.js";\nimport { x as y } from "./narrowbar";\n',
  };
  assert.deepEqual(after(DIR_MOVE, sources, "components/binder.js"), ["./ui/narrow/index.js", "./ui/narrow"]);
});

const BARREL = {
  "lib/dom.js": LEAF,
  "lib/coerce.js": LEAF,
  "lib/index.js":
    'export * from "./coerce.js";\nexport { x as d } from "./dom.js";\nexport * as ns from "./coerce.js";\n',
};

test("a barrel re-exporting a moved file follows it", () => {
  assert.deepEqual(after(SINGLE_MOVE, BARREL, "lib/index.js"), ["./core/coerce.js", "./dom.js", "./core/coerce.js"]);
});

test("a moved barrel's re-export specifiers are recomputed from its new directory", () => {
  assert.deepEqual(after({ from: "lib/index.js", to: "lib/api/index.js" }, BARREL, "lib/index.js"), [
    "../coerce.js",
    "../dom.js",
    "../coerce.js",
  ]);
});

test("a string-literal import() and require() follow the moved file", () => {
  const sources = {
    "lib/x.js": LEAF,
    "app.cjs": 'const a = require("./lib/x.js");\nconst b = import("./lib/x.js");\n',
  };
  assert.deepEqual(after({ from: "lib/x.js", to: "src/x.js" }, sources, "app.cjs"), ["./src/x.js", "./src/x.js"]);
});

test("a JSDoc import() type reference follows the moved file", () => {
  const sources = {
    "components/widgets/Field.js": LEAF,
    "components/live/View.js":
      '/** @param {import("../widgets/Field.js").Field} f */\nexport function view(f) {\n  return f;\n}\n',
  };
  assert.deepEqual(
    after(
      { from: "components/widgets/Field.js", to: "components/widgets/form/Field.js" },
      sources,
      "components/live/View.js",
    ),
    ["../widgets/form/Field.js"],
  );
});

test("bare, absolute and node: specifiers stay as written beside a rewritten relative one", () => {
  const sources = {
    "lib/coerce.js": LEAF,
    "main.js": 'import "preact";\nimport "/lib/coerce.js";\nimport "node:path";\nimport "./lib/coerce.js";\n',
  };
  assert.deepEqual(after(SINGLE_MOVE, sources, "main.js"), [
    "preact",
    "/lib/coerce.js",
    "node:path",
    "./lib/core/coerce.js",
  ]);
});

test("a moved file's import of itself stays as written while its other imports follow the move", () => {
  const sources = {
    "dom.js": LEAF,
    "self.js": 'import "./dom.js";\nexport const load = () => import("./self.js");\n',
  };
  assert.deepEqual(after({ from: "self.js", to: "sub/self.js" }, sources, "self.js"), ["../dom.js", "./self.js"]);
});

test("a non-literal import() anywhere in the tree is carried into the plan as unresolvable", () => {
  const sources = {
    "lib/coerce.js": LEAF,
    "loader.js": "export const load = (name) => import(name);\n",
  };
  assert.deepEqual(
    planFor(SINGLE_MOVE, sources).unresolvable.map((site) => [site.file, site.text, site.line]),
    [["loader.js", "name", 1]],
  );
});

test("an ambiguous specifier aborts the plan", () => {
  const sources = {
    "x.js": LEAF,
    "x.mjs": LEAF,
    "main.js": 'import "./x";\n',
  };
  assert.throws(() => planFor({ from: "x.js", to: "lib/x.js" }, sources), AmbiguousSpecifier);
});
