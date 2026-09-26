#!/usr/bin/env bash
#
# Run the proof moves on a scratch copy of tests/corpus/ and check resolution
# after each one.
#
#   scripts/proof.sh
#
# The copy lands in ${CLAUDE_SCRATCH:-/tmp}/jsmover-proof-<pid>/ with an overlay
# of barrel re-exports, a runtime import() and a require(), is committed to a
# fresh git repository, and is checked with scripts/resolve-check.mjs --jsdoc
# before any move. Each move then runs through bin/jsmover.js, is checked again,
# and prints its `git diff --stat HEAD`. The last line is `proof: ok`, or
# `proof: FAIL <move>` for the first move that left a miss or exited non-zero.

set -uo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work="${CLAUDE_SCRATCH:-/tmp}/jsmover-proof-$$"
check="$repo/scripts/resolve-check.mjs"

MOVES=(
	"lib/coerce.js lib/core/coerce.js"
	"components/narrowbar components/narrow"
	"components/tabs/OutputTab.js components/output/OutputTab.js"
	"components/widgets/Field.js components/widgets/form/Field.js"
	"lib/dyn.js lib/dynamic/dyn.js"
	"lib/barrel.js lib/exports/barrel.js"
)

fail() {
	echo "proof: FAIL $1"
	exit 1
}

overlay() {
	printf '%s\n' 'export * from "./coerce.js";' 'export { truthy } from "./coerce.js";' >lib/barrel.js
	printf '%s\n' 'export const loadCoerce = () => import("./coerce.js");' >lib/dyn.js
	printf '%s\n' 'const coerce = require("./coerce.js");' 'module.exports = coerce;' >lib/cjs.cjs
	printf '%s\n' 'import { truthy } from "./barrel.js";' 'export const enabled = truthy;' >lib/barrel-user.js
}

mkdir -p "$work" || fail "setup: cannot create $work"
cp -R "$repo/tests/corpus/." "$work/" || fail "setup: copy"
cd "$work" || fail "setup: cd $work"
overlay || fail "setup: overlay"
git init -q . || fail "setup: git init"
git add -A || fail "setup: git add"
git -c user.name=proof -c user.email=proof@localhost commit -qm baseline || fail "setup: git commit"
echo "proof: tree $work"

echo "== baseline"
node "$check" . --jsdoc || fail "baseline"

for move in "${MOVES[@]}"; do
	read -r from to <<<"$move"
	label="$from -> $to"
	echo "== $label"
	node "$repo/bin/jsmover.js" mv "$from" "$to"
	moved=$?
	echo "jsmover exit=$moved"
	node "$check" . --jsdoc
	checked=$?
	git diff --stat HEAD
	[ "$moved" -eq 0 ] && [ "$checked" -eq 0 ] || fail "$label"
done

echo "proof: ok"
