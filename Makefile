VENV := .venv/bin

.PHONY: lint lint-js test-js check trivia

lint:
	$(VENV)/filepawl check
	$(VENV)/triviajudge-archaeology $$(git ls-files '*.js' '*.md' | grep -v '^tests/')

lint-js:
	npx eslint .
	npx prettier --check "bin/**/*.js" "src/**/*.js" "tests/*.test.js" "eslint-rules/*.js" "scripts/**/*.mjs" eslint.config.js jsconfig.json knip.json .jscpd.json
	npx tsc -p jsconfig.json --checkJs
	npx knip
	npx jscpd

# Explicit file list, not `tests/`: node's test runner rejects a bare directory
# argument. The tests/ exclusion leaves the tree under test: the suite itself is
# not code under test.
test-js:
	node --experimental-test-coverage \
	  --test-coverage-exclude='tests/**' \
	  --test-coverage-lines=95 \
	  --test-coverage-branches=90 \
	  --test-coverage-functions=85 \
	  --test tests/*.test.js

check: lint lint-js test-js

# Asks a model whether what HEAD added narrates history instead of stating what
# holds now. Needs a logged-in `claude` CLI and the network, so it stays out of
# `check`, which is offline.
trivia:
	$(VENV)/triviajudge-md --head
	$(VENV)/triviajudge-comments --head
	$(VENV)/triviajudge-changelog --head
