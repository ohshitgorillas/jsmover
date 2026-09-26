# jsmover

`jsmover mv <old> <new>` moves a JavaScript file or directory and rewrites every relative import specifier the move breaks: static `import` and `export ... from`, dynamic `import()`, `require()`, and barrels that re-export the moved module; `--dry-run` prints the plan without touching a file, and inside a git repository the move is a `git mv`. It needs Node 22 or newer and has no build step; `npm install` fetches the JavaScript gates, a Python 3.12+ `.venv` with `pip install filepawl triviajudge` supplies the repository gates, and `make check` runs every gate and the test suite.
