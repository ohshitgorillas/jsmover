# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-26

### Added

- **`jsmover mv <old> <new>` moves a JavaScript file or directory and rewrites every relative specifier the move breaks.** Static imports, re-exports, `import()`, `require()` and JSDoc `import("...")` type references are rewritten in every `.js`, `.mjs` and `.cjs` file under the current directory, keeping each specifier's shape: exact file name, extensionless name, or directory.
- **`--dry-run` prints the plan and touches nothing.** The plan lists one `move:` line per moved file and one `path:line: old -> new` line per rewritten specifier.
- **Inside a git work tree, tracked sources move with `git mv`** and the scan covers only the files `git ls-files` lists, tracked or untracked but not ignored.
- **A move is refused before any change** when a file fails to parse, a specifier resolves to more than one file, or the destination exists. A failure partway through the move restores the tree.
- **Advisories on stderr** list string literals and comments that still name the old location, and each `import()` or `require()` whose argument is not a string literal.
