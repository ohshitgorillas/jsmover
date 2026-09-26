# jsmover design

This document states what jsmover does, how it is built, and the rules every change holds to. Each requirement names the test that pins it and the failure that test excludes.

## 1. Scope

jsmover has one job: `jsmover mv <old> <new>` moves a file or a directory and rewrites every relative specifier the move breaks, in every file that holds one.

A relative specifier starts with `./` or `../`. Bare specifiers (`preact`, `preact/hooks`), absolute specifiers (`/static/app.js`) and URL specifiers (`node:fs`, `https://…`) name something the move does not change, so jsmover leaves them untouched.

Out of scope, with no partial support:

- TypeScript source, JSX, and any file a JavaScript parser rejects without a plugin.
- Bundler aliases (`@/lib/dom.js`) and path mapping of any kind.
- Reading `tsconfig.json`, `jsconfig.json` or `package.json` (`imports`, `exports`, `main`) to resolve a specifier.
- Editing importmaps, HTML files, or any file that is not `.js`, `.mjs` or `.cjs`.
- Editing a specifier that is not a string literal: a template literal, a concatenation, or a variable passed to `import()` or `require()`.

## 2. Language: Node.js ESM, no build step

jsmover is written in plain JavaScript as Node.js ES modules and runs without a build step. The trees it edits are JavaScript, including the proof corpus, so the tool and its targets share one language, one parser and one set of gates.

The suite runs under `node --test`. The gates in `make check` (eslint, prettier, `tsc --checkJs` over JSDoc types, knip, jscpd) are the same gates a JavaScript target tree runs, which keeps the tool's own code held to the standard of the code it edits.

The CLI runs by `npx jsmover` or through the `bin/jsmover.js` entry named in `package.json`, and needs Node 22 or newer.

## 3. Parsing

jsmover parses every scanned file with acorn, using these options:

- `ecmaVersion: "latest"`, so current syntax (optional chaining, class fields, top-level `await`) parses.
- `locations: true`, so every site carries a line number for reports.
- `onComment` collecting every comment with its start and end offsets.
- `sourceType: "module"` first; on a parse failure, a second parse with `sourceType: "script"`, so CommonJS files that use `require()` and non-strict syntax parse. A file that fails both parses is a parse failure under R5.

A specifier site is one of:

- `ImportDeclaration.source`
- `ExportNamedDeclaration.source`
- `ExportAllDeclaration.source`
- `ImportExpression` whose argument is a string `Literal`
- `CallExpression` whose callee is the identifier `require` and whose single argument is a string `Literal`
- `import("<relative>")` inside a comment, the JSDoc type reference form

Every rewrite is a byte splice into the original text at the site's `start` and `end` offsets, replacing the literal's contents between its quotes. Nothing outside the spliced ranges changes, because the file is never reprinted from the tree.

Rejected alternatives:

- **Regular expressions over source text.** Strings, comments, template bodies and regex literals all hold text shaped like `import "./x.js"` that is not a specifier, so a regex rewrites false sites and misses sites split across lines.
- **`es-module-lexer`.** It reports static and dynamic imports only: it sees no `require()` call and no comment, so CommonJS sites and JSDoc type references go unrewritten.
- **ts-morph and the TypeScript compiler API.** They need a project and a `tsconfig.json` to resolve anything, and they reprint the files they edit, which changes quotes and formatting outside the specifier.
- **jscodeshift and recast.** They reprint quotes (`"./lib/dom.js"` becomes `'./lib/dom.js'`) and fail on syntax their bundled `ast-types` lacks, such as optional chaining, which aborts the whole run.
- **`uglify-js`.** Its parser accepts ES5 only and rejects `import` and `export`.

## 4. Requirements

Each requirement is a rule that holds for every run, followed by the test that pins it and the failure it excludes.

**R1. Extension shape is preserved.** A specifier written with an extension keeps that extension in its new form, and an extensionless specifier stays extensionless. For an ES module a browser loads, a specifier resolves only by exact match with no extension probing, so moving `lib/coerce.js` to `lib/core/coerce.js` turns `"../lib/coerce.js"` into `"../lib/core/coerce.js"`, never `"../lib/core/coerce"`. Test: `tests/specifier.test.js` feeds one `.js` specifier and one extensionless specifier for the same move and asserts each new text keeps its own shape. Excludes: a rewritten import that resolves under Node probing and fails to load in a browser.

**R2. The moved file's own outward specifiers are rewritten.** A relative specifier inside the moved file that points at a file outside the move is recomputed from the file's new location. Test: `tests/plan.test.js` moves a file one directory deeper and asserts its `"./dom.js"` import becomes `"../dom.js"`. Excludes: a moved file whose own imports resolve against its old directory.

**R3. A directory move takes every file beneath it and keeps its internal specifiers as written.** Every file under the moved directory moves with it, stylesheets, data and any other non-JavaScript file included, and no directory remains at the old path once the move completes. A specifier between two moved files is byte-identical after the move. Specifiers crossing the boundary are rewritten in both directions: from outside into the directory (`components/binder.js` importing `"./narrowbar/facettip.js"` becomes `"./narrow/facettip.js"` when `components/narrowbar` moves to `components/narrow`), and from inside to outside. A specifier written as `dir/index.js` keeps that form, and a bare directory specifier (`./dir`) resolving through `index.js` keeps that form while the index stays in a directory the specifier can name, and becomes an explicit file path otherwise. A rewrite never adds a `../` segment beyond what the new relative path needs. Test: `tests/plan.test.js` holds that, for a directory of two files importing each other plus one outside importer, the internal specifier is unchanged and the outside one follows the move; `tests/cli.test.js` holds that a `.css` file beside `.js` files moves with its directory and that no directory remains at the old path. Excludes: a directory move that rewrites, re-extensions or re-roots imports between files that moved together, and one that strands the directory's non-JavaScript files at the old path.

**R4. Nothing but affected specifier text changes.** The only bytes that differ after a move are the contents of the specifiers the move breaks. Quote style stays as written, import order stays as written, no whitespace or formatting changes, and no alias replaces a relative path (`"./lib/dom.js"` never becomes `"@/lib/dom.js"`). A vendor or minified file changes only at an affected specifier. Test: `tests/apply.test.js` moves a file in a fixture tree whose files mix quote styles, unsorted imports and irregular spacing, and asserts every other file is byte-identical and the importer differs from its original on the specifier's line only. Excludes: a move that produces a diff across the whole tree for a one-file change.

**R5. The whole tree parses before any write.** Every scanned file is parsed before the first byte is written. A parse failure in any scanned file aborts the run with nothing touched and exit 1, printing the file and the parser's position. Test: `tests/cli.test.js` runs a move in a fixture where one unrelated file holds a syntax error, and asserts exit 1 and that the source still exists at its old path. Excludes: a half-applied move that stops at the first unparseable file.

**R6. The apply step is atomic.** Every new file body is computed in memory before any write. The move is one filesystem operation on the path the user named, a file or a whole directory, and each rewritten file is written at its path after that move. If any write or the move fails, every touched file is restored from the in-memory originals and the move is undone. No run leaves a 0-byte file or an empty destination directory. Test: `tests/apply.test.js` holds that when a filesystem fake's second write fails, every file's contents equal the originals. Excludes: a tree left with some importers rewritten and the file not moved, or the reverse.

**R7. No configuration file is required.** jsmover reads no configuration file, and a move runs with only the two paths. Test: `tests/cli.test.js` runs a move in a fixture with no `package.json`, `tsconfig.json` or `jsconfig.json`, and asserts exit 0 and the importer rewritten. Excludes: a tool that refuses or silently does nothing until a config file exists.

**R8. Barrels are rewritten both ways.** `export * from`, `export { x } from` and `export * as ns from` are specifier sites like any import. A barrel that re-exports the moved file is rewritten, and a barrel that itself moves has its re-export specifiers recomputed. Test: `tests/plan.test.js` runs one move of the target and one move of the barrel, asserting the re-export specifier in each case. Excludes: a barrel left re-exporting a path that no longer exists.

**R9. String-literal `import()` and `require()` are rewritten; anything else is reported.** `import("./x.js")` and `require("./x.js")` are rewritten like static imports. An `import()` or `require()` whose argument is not a plain string literal, including any template literal, is left unchanged and printed as `path:line: unresolvable dynamic specifier`; this report does not change the exit status, which stays 0. Test: `tests/plan.test.js` asserts the literal site is rewritten, and `tests/report.test.js` asserts the non-literal site appears with its path and line. Excludes: a runtime import that breaks with no trace in the output.

**R10. JSDoc `import()` type references are rewritten.** An `import("./x.js")` inside a comment is a specifier site. `tsc --checkJs` resolves these references, so a move that leaves `/** @param {import("../widgets/Field.js").Field} f */` in `components/live/View.js` pointing at the old path fails the target tree's type check. Test: `tests/jsdoc.test.js` asserts the comment site's offsets, and `tests/plan.test.js` asserts its rewrite. Excludes: a move that leaves the runtime graph intact and the type check red.

**R11. Bare, absolute and `node:` specifiers are untouched.** A specifier that does not start with `./` or `../` is never resolved and never rewritten, even when its text contains the moved path. Test: `tests/plan.test.js` places `"preact"`, `"/lib/coerce.js"` and `"node:path"` beside a relative import of the moved file and asserts only the relative one changes. Excludes: a rewrite of a package import that happens to share a name with the moved file.

**R12. The move itself is guarded and uses git inside a work tree.** The destination's missing parent directories are created, and no other directory is. An existing destination refuses the move before any change, with exit 1, on a dry run as on a real one; only the destination the user named is checked. When `git rev-parse --is-inside-work-tree` succeeds and `git ls-files --error-unmatch <old>` reports the source tracked, the move is a `git mv`, and a `git mv` failure surfaces git's own error text and exit status; outside a work tree, or for an untracked source, the move is a plain rename. Test: `tests/cli.test.js` holds that an existing destination means exit 1 and an unchanged tree, `tests/apply.test.js` holds that `takenDestination` names an existing destination and is `null` for a free one, and `tests/git.test.js` holds that a tracked file moved inside a fixture repository is staged as a rename. Excludes: an overwritten destination, and a moved file that git records as a delete plus an untracked file.

**R13. Exit codes are fixed.** Exit 0 means the move and every rewrite applied. Exit 1 means the move was refused or failed, and nothing in the tree changed. Exit 2 means a usage error. Test: `tests/cli.test.js` asserts one run for each status. Excludes: a script caller that cannot tell a refused move from a completed one.

**R14. Stale literals are reported, never edited.** After the move, every string literal or comment text outside a rewritten site that contains the old root-relative path, or a `./`/`../` path that resolves from its file to the old location, is printed as `path:line: text`. These lines are advisory and none of them is edited. Test: `tests/report.test.js` asserts a string literal holding the old root-relative path is listed with its path and line, and `tests/apply.test.js` asserts that file is byte-identical. Excludes: a hard-coded path in a lookup table or a log message that goes stale with no mention.

**R15. Resolution is exact first, then Node probing, and ambiguity aborts.** A specifier resolves to the file it names exactly when that file exists. Failing that, resolution probes, in order, `.js`, `.mjs`, `.cjs`, `.json`, `/index.js` and `/index.mjs`. An extensionless specifier that matches more than one candidate aborts the run with exit 1, listing the candidates. Test: `tests/resolve.test.js` asserts exact match over a probed candidate, and asserts the abort lists both `x.js` and `x.mjs` for a specifier `./x` that matches both. Excludes: a rewrite that picks one of two files at random.

**R16. `--dry-run` prints the full plan and touches nothing.** A dry run prints one move line per file the move takes, each file to be rewritten, and each rewrite as `path:line: old -> new`, and changes no file. The plan a dry run prints equals the plan the real run applies. Test: `tests/cli.test.js` holds that every file is byte-identical across a dry run, and that a dry run's plan lines equal those of a real run on a copy of the same fixture. Excludes: a preview that differs from what the move does.

**R17. The scan covers every file under the root, and every JavaScript file is parsed.** Every file under the root is scanned, except those under a `node_modules/` or `.git/` directory, so a specifier naming a non-JavaScript file such as `./data.json` or `./style.css` resolves and is rewritten. Only the `.js`, `.mjs` and `.cjs` files among them are parsed for specifier sites. Test: `tests/scan.test.js` holds that an importer with each extension is in the scan and a file under `node_modules/` is not, and `tests/plan.test.js` holds that a `./data.json` import follows the moved data file. Excludes: a `.cjs` or `.mjs` importer left pointing at the old path, and an import of a data file or stylesheet left pointing at the old path.

**R18. A self-referential specifier stays as written.** A specifier inside the moved file that resolves to the moved file itself is left unchanged. Test: `tests/plan.test.js` moves `self.js`, which contains `import("./self.js")`, and asserts the specifier is unchanged. Excludes: a self-import rewritten to a path computed from the old location.

## 5. Module layout

Each module holds one concern.

- `bin/jsmover.js`: the executable; passes `process.argv` and the standard streams to `src/cli.js` and exits with the status it returns.
- `src/cli.js`: turns argv into a command and returns the exit status.
- `src/scan.js`: walks the tree and returns every file in it; `isSource` picks the files to parse.
- `src/parse.js`: runs acorn over one file's text and returns its specifier sites; defines `Text` and `Site`.
- `src/jsdoc.js`: returns the `import()` sites inside one file's comments.
- `src/resolve.js`: maps a relative path and the file holding it to a target path.
- `src/specifier.js`: computes the new specifier text for a site, preserving its shape. Pure.
- `src/plan.js`: turns the requested move and the parsed sites into the per-file moves and rewrites. Pure, with no I/O; defines `Move`, `Rewrite` and `Plan`.
- `src/apply.js`: checks the destination (`takenDestination`), performs the one move and the writes, and restores every touched file on failure.
- `src/git.js`: detects a work tree and runs `git mv`.
- `src/report.js`: formats the plan text, the unresolvable-site lines and the stale-literal report.

Each type is defined once, in the module named above, and every other module refers to it as `import("./x.js").T`.

`plan.js` and `specifier.js` take plain data and return plain data: paths, texts and offsets in, moves and splices out. Everything that reads or writes the filesystem or spawns a process lives outside them.

## 5a. Data contract

Modules exchange plain objects with no methods and no class instances. Every path in them is relative to the root of the tree being edited.

- A `Text` is `{ file, start, end, text, line }`: a span of one file, used for string literals and comment bodies. `file` is the root-relative path of the file holding it, `start` and `end` its offsets, `text` what lies between them and `line` the line it starts on.
- A `Site` is a `Text` with one more field, `kind`. For a specifier, `start` and `end` are the offsets of the literal's contents between its quotes, so the quotes themselves lie outside the range, and `text` is that content. `kind` is one of `import`, `export`, `dynamic`, `require` or `jsdoc`.
- A `Move` is `{ from, to }`, both root-relative.
- A `Rewrite` is a `Site` with one more field, `replacement`: the text that takes the place of `text` between `start` and `end`.
- A `Plan` is `{ move, moves, rewrites, unresolvable }`. `move` is the one physical move the user asked for, of a file or a directory, and is the only move `apply` performs and the only destination it checks. `moves` is a `Move[]` mapping each file the move takes to its new path, the file itself or every file beneath the directory; it drives the rewrites and the dry-run lines. `rewrites` is a `Rewrite[]` and `unresolvable` is a `Site[]`.

`resolve(record, files)` takes any record carrying `{ file, text, line }`, where `text` is a relative path written in `file`, and the root-relative paths of the tree's files. It returns the root-relative path the text names, or `null` when no file matches. When more than one file matches, it throws an `AmbiguousSpecifier` that carries the record and the candidate paths.

`takenDestination(root, plan, io)` returns `plan.move.to` when something exists there and `null` otherwise; the CLI refuses a dry run and a real run alike on it, and `apply` refuses on it with a `DestinationExists` error.

## 6. Testing

Tests live in `tests/*.test.js` and follow `docs/testing.md`.

- Each test builds its fixture tree in a fresh temporary directory from a string table declared inside the test, mapping relative paths to file contents.
- Pure modules (`specifier.js`, `plan.js`, `report.js`) are tested directly with plain data; filesystem and CLI tests cover only what the pure lanes cannot observe.
- Each test holds one assertion.
- New tests prove bite with a red run against a null stub: the module present, its exports named, every function returning its zero value.

## 7. Corpus and proof

The proof corpus lives at `tests/corpus/` inside this repository. It is a copy of the hqptuner front-end tree at `~/dev/hqptuner/hqptuner/static`, holding its 169 JavaScript files and its `index.html` in their original directory layout, with the stylesheets and fonts left out.

The corpus is foreign code and sits outside every gate's scope. These scopes are owner-approved exemptions, and they are the only gate settings that name the corpus:

- `eslint.config.js`: `ignores` lists `tests/corpus/**`.
- `Makefile`: the prettier globs name `tests/*.test.js`, never `tests/**/*.js`.
- `jsconfig.json`: `exclude` lists `tests/corpus`.
- `knip.json`: `ignore` lists `tests/corpus/**`.
- `.jscpd.json`: `ignore` lists `tests/corpus/**`.
- `.pre-commit-config.yaml`: the `prettier` hook's `exclude` is `^(package(-lock)?\.json|tests/corpus/.*)$`.
- `pyproject.toml`: `[tool.filepawl.javascript]` `include` lists only `bin/**/*.js`, `src/**/*.js`, `scripts/**/*.js`, `scripts/**/*.mjs`, `tests/*.js` and `tests/support/**/*.js`.

`scripts/proof.sh` copies `tests/corpus/` into the scratch directory before the moves and runs the proof moves on the copy, so the committed corpus is never edited. The corpus holds no barrel re-exports, no runtime `import()` and no `require()`, so `scripts/proof.sh` lays a small overlay of files exercising those forms onto the copy before the moves run.

`scripts/resolve-check.mjs` is the oracle. It carries its own lexer and imports nothing from `src/`, so a defect in jsmover's parser cannot hide itself. It checks that every relative specifier in the tree, including JSDoc `import()` references, resolves to an existing file. `scripts/proof.sh` runs it before and after each move, and reports the count of changed lines between the moved tree and the untouched copy alongside it.
