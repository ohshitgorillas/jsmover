# jsmover

`jsmover mv <old> <new>` moves a JavaScript file or directory and rewrites every relative import specifier the move breaks: static `import` and `export ... from`, dynamic `import()`, `require()`, and barrels that re-export the moved module. It needs Node 22 or newer and has no build step; `npm install` fetches the JavaScript gates, a Python 3.12+ `.venv` with `pip install filepawl triviajudge` supplies the repository gates, and `make check` runs every gate and the test suite.

## Usage

```
jsmover mv <old> <new> [--dry-run]
```

`<old>` and `<new>` are paths relative to the current directory, which is the root of the tree jsmover scans and edits. Every `.js`, `.mjs` and `.cjs` file under it is parsed before any write; no configuration file is read.

- The plan goes to stdout: one `move: <old> -> <new>` line per moved file, then one `path:line: old -> new` line per rewritten specifier.
- `--dry-run` prints the same plan and touches nothing.
- Inside a git work tree a tracked source moves with `git mv`; otherwise it is a plain rename. The destination's parent directories are created when missing.
- After the move, stderr lists every string literal or comment that still names the old location, as `path:line: text`, and every `import()` or `require()` whose argument is not a string literal, as `path:line: unresolvable dynamic specifier`. These lines are advisory and do not change the exit status.

## Exit status

- `0`: the move and every rewrite applied, or a dry run printed the plan.
- `1`: the move was refused or failed and the tree is unchanged: a file that does not parse (reported as `file:line:column: message`), a specifier matching more than one file, an existing destination, or a failed write or `git mv`.
- `2`: a usage error: a missing subcommand, the wrong number of paths, an unknown option, or a source that does not exist.
