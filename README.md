# jsmover

jsmover moves a JavaScript file or directory and rewrites every relative import specifier the move breaks.

## Usage

```
jsmover mv <old> <new> [--dry-run]
```

`<old>` and `<new>` are paths relative to the current directory, which is the root of the tree jsmover scans and edits. Every `.js`, `.mjs` and `.cjs` file under it is parsed before any write; no configuration file is read. Inside a git work tree the files are those `git ls-files` lists, tracked or untracked but not ignored, so ignored directories and nested worktrees are left out; outside one, every file is taken except those under `node_modules` or `.git`.

- The plan goes to stdout: one `move: <old> -> <new>` line per moved file, then one `path:line: old -> new` line per rewritten specifier.
- `--dry-run` prints the same plan and touches nothing.
- Inside a git work tree a tracked source moves with `git mv`; otherwise it is a plain rename. The destination's parent directories are created when missing.
- After the move, stderr lists every string literal or comment that still names the old location, as `path:line: text`, and every `import()` or `require()` whose argument is not a string literal, as `path:line: unresolvable dynamic specifier`. These lines are advisory and do not change the exit status.
