import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/cli.js";

const sink = { write: () => true };

test("no arguments exits with usage status 2", () => {
  assert.equal(main([], sink), 2);
});
