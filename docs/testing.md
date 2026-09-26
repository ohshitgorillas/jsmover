# Testing policy — binding for all contributors, human or agent

Violations rejected in review even if tests pass.

## Core rules

1. **Test behavior and intent, never implementation.** Test asserts observable contract: given this input, public API yields this result. Refactor preserves behavior but breaks test = test defective. Module layout, private helpers, internal state, call sequences, log text — all off-limits.

2. **One assertion per test.** Each test asserts one condition. Failure names one broken behavior. A boolean conjunction is one assertion per operand. `eslint-rules/assertion-shape.js` reports the conjunction, root-only.

3. **Public API only.** Tests exercise same surface a caller would. No reaching into private state, no monkeypatching internals.

4. **Fakes speak the real interface; mocks of our own code forbidden.** Never stub the unit's own functions to test the unit.

5. **Anchor on stable contract facts, not golden dumps.** Compare specific fields with known meaning, never whole-structure equality against snapshot — snapshots re-assert implementation back at itself, break on harmless change.

6. **Test names state behavior** in plain words, not a sequence number.

7. **No test waits on wall clock.** Retry/verify/poll loop tested for how many passes it makes and what it concludes — never how long it takes. So production code paces itself through injectable clock, suite virtualizes it.
   - **Advance clock; never freeze one half.** No-op `sleep` with real `monotonic` turns every deadline loop into hot spin hammering fake for full wall-clock deadline — slower than sleeps it removed, and different code path than production.

   Reason: real sleeps dominate suite wall time. Test reintroducing wall-clock wait is defective even when it passes.

8. **New tests must bite.** A test written for new or changed behavior must fail against the pre-change code — a test that is green both with and without the change constrains nothing, however well-shaped it looks to the mechanical gates. Bite is checked by a red run: implementation reverted to HEAD (tests kept), new tests re-run, red expected. Assertion failure is the only result that proves bite. A collection or import error proves the test names a symbol that does not exist yet, which every test of a new surface does regardless of what it asserts; it is not weak evidence, it is no evidence. Where the surface is new and no red run can say anything, the obligation is discharged statically instead: the null stub each test fails is named — the module present, exports named, every function returning its zero value. Tests with no pre-change state to fail against — characterization of existing behavior, tests accompanying a pure refactor — are exempt, and the exemption is stated in the hand-back rather than assumed silently.

9. **A test asserts only strings it put in the input itself, contract identifiers, and numbers derived from input data. Every string born inside `src/` is copy.** Usage lines, messages, status lines and error text are reworded at will. The test: to know this literal, would the writer have to read `src/`? Then it is copy, and it stays out of the assertion. A path the fixture handed in is input data and may be asserted; the sentence the tool wraps around it may not. Contract identifiers — option names, JSON keys, error codes, exit statuses — are contract, and pinning those is correct. Consequences:
   - **Error text is copy.** Errors carry a code; tests match the type plus the code, never the message. `error.includes(...)` is legal only for a contract identifier, never a sentence.
   - If nothing meaningful survives removing the wording, delete the test instead of leaving a tautology.

10. **A test discriminates, or it is a tautology.** The question a test answers is not "does the code do something" but "which of these two implementations am I looking at". An assertion the wrong implementation also satisfies constrains nothing, and it costs the same to run and maintain as one that does. The shapes that fail this, all of them common and all of them green:
    - **Asserting one call's absolute output.** A single input with a single expected value is a lookup-table entry, and a table is exactly the wrong implementation the suite exists to exclude. Assert a relation between two observations, or make the surrounding set of tests carry two distinct expected values on the same surface.
    - **Asserting existence instead of value.** Truthiness, `!== null`, a type check, a length, a key's presence. Legal only where existence *is* the contract and the value is genuinely unbounded, owner-approved like every exemption; every other existence-only assertion is reported.
    - **Asserting a value the absent feature also produces.** `0`, `null`, `""`, `[]`, `false`, the default the fixture already carried. If the expected value equals the zero value, the test passes against a feature that was never written.
    - **Asserting the fix's own mechanism.** A new helper was called, a new flag is set, a new field exists. That is rule 1; it reads as discrimination because the mechanism is new, and it breaks on the first refactor while catching no defect.
    - **Round-tripping a writer through its own reader.** Both halves wrong in the same direction pass. Pin one half against a value the fixture supplied, not against the other half.
    - **Restating the implementation's arithmetic.** A test computing the expected number the same way the code does asserts that the language is deterministic. Write the number.

    The check is mechanical: name an implementation that fails the assertion and one that passes it, both plausible. If the failing one is only "the feature is absent", the test pins nothing beyond presence. Where the unit is pure mathematics this check has no repair — every numeric assertion restates an identity the implementation was derived from — so such a module is pinned against an external reference oracle committed as fixtures, not against a plan.

11. **A test guards against a bug, never against a change of mind.** Before a test is kept, write the bug report its failure would file. "Rewritten specifier points at the old path" is a bug; "plan lines are no longer in this order" is a diff. If the only way to turn the test red is for the owner or a forker to decide differently, it pins a decision: reshape it into the invariant the decision serves, or delete it. The shapes:
    - **The instance instead of the invariant.** Assert the property the design promises, at two inputs where the property does work: sorted, unique, one per option, inside the wrapper. Never the literal the current design emits.
    - **A default as an absolute.** The owner's default for a knob is a decision. Test its role: an unset option reads as the default, a written one overrides it.
    - **Formatting.** Rounding, key order, indentation, the string form of a number, unless a contract demands it.

    The tell: a value the test's own fixture put in the input may be asserted back verbatim; a value the design chose is not the fixture's and is not asserted absolutely. Rule 10 asks for two distinct expected values on a surface; satisfy it with two inputs to the invariant, never two design literals.

12. **A test costs.** Run time, maintenance, and every reader's time. A test that constrains nothing another test does not already constrain is deleted; deletion is a review outcome, not a coverage regression. Two tests where one cannot fail without the other are one test. Each test earns its place by the wrong implementation it kills. A test written to reach a line is rule 1 by another route: a line unreachable through the contract is dead, or the surface is wrong. Fix the code.

13. **Fakes answer from tables, never from logic.** A fake that derives its reply by the algorithm the code uses is a second implementation, wrong together with the first. The test writes the table.

14. **Helpers return values.** No `assert` lives outside a test body. A helper returns the evidence and the test asserts it; a fixture that must refuse to run throws.

15. **Lowest lane.** A behavior is tested at the lowest lane that observes it: pure function, then filesystem, then the CLI. A CLI test a unit test already covers is deleted.

16. **No environment coupling.** No test reads hostname, locale, timezone, cwd, HOME or a fixed port. Rule 7 covers the clock; this covers the rest.

17. **One unit, one result.** A decision lives in a function whose return value is the decision; an orchestrator executes decisions and does not make them. A function returns one type on every path: a typed result, not an object whose keys differ by branch, and not a boolean carrying two meanings. New behavior that cannot name the one value its test will assert is split before it is written.

## Frontend

The core rules bind the JS suite. Runner is node's built-in `node --test`, via `make test-js`.

- **One assertion per test enforced, not merely asked for.** `eslint-rules/one-assertion-per-test.js` does not look inside nested functions, so assertion wrapped in helper or `.then()` callback counts as **zero** and is flagged. Deliberate: gate you defeat by moving assert into function is not a gate. Keep assert at call site — if helper builds condition, have it return `[ok, message]` and spread into one `assert.ok(...)`. The `assertion-shape` rule reads the shape of the one assertion the count rule counts, root-only.

### Harness facts

- **`node --test` rejects bare directory argument** here; pass explicit file list.
- **Cache-busting query suffix silently destroys a file's coverage.** Node keys coverage by URL, then groups by path with the query stripped and keeps the last entry per path. Test reaching second module instance through `?v=2`-style suffix therefore overwrites real instance's coverage with load-only one's, and file reports near-zero functions however well tested.
