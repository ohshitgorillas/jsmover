import { test } from "node:test";
import assert from "node:assert/strict";
import { newSpecifier } from "../src/specifier.js";

test("a specifier written with .js keeps .js after its target moves deeper", () => {
  assert.equal(
    newSpecifier("../lib/coerce.js", "lib/coerce.js", "store/state.js", "lib/core/coerce.js"),
    "../lib/core/coerce.js",
  );
});

test("an extensionless specifier stays extensionless for the same move", () => {
  assert.equal(
    newSpecifier("../lib/coerce", "lib/coerce.js", "store/state.js", "lib/core/coerce.js"),
    "../lib/core/coerce",
  );
});

test("an extensionless specifier of an .mjs target stays extensionless", () => {
  assert.equal(newSpecifier("./x", "x.mjs", "app.js", "lib/x.mjs"), "./lib/x");
});

test("a target moved into the importer's directory is written with a leading ./", () => {
  assert.equal(newSpecifier("../lib/dom.js", "lib/dom.js", "app/main.js", "app/dom.js"), "./dom.js");
});

test("an importer moved one directory deeper reaches its sibling through ../", () => {
  assert.equal(newSpecifier("./dom.js", "lib/dom.js", "lib/core/coerce.js", "lib/dom.js"), "../dom.js");
});

test("a target below the importer's directory takes no ../ segment", () => {
  assert.equal(newSpecifier("../b/d.js", "b/d.js", "a/b/c.js", "a/b/x/d.js"), "./x/d.js");
});

test("a specifier between two files that moved together is unchanged", () => {
  assert.equal(
    newSpecifier(
      "./facettip.js",
      "components/narrowbar/facettip.js",
      "components/narrow/binder.js",
      "components/narrow/facettip.js",
    ),
    "./facettip.js",
  );
});

test("a dir/index.js specifier keeps its index.js form", () => {
  assert.equal(
    newSpecifier(
      "./narrowbar/index.js",
      "components/narrowbar/index.js",
      "components/binder.js",
      "components/narrow/index.js",
    ),
    "./narrow/index.js",
  );
});

test("a bare directory specifier follows its renamed directory", () => {
  assert.equal(
    newSpecifier("./narrowbar", "components/narrowbar/index.js", "components/binder.js", "components/narrow/index.js"),
    "./narrow",
  );
});

test("a bare directory specifier from a deeper importer climbs with ../", () => {
  assert.equal(
    newSpecifier(
      "./narrowbar",
      "components/narrowbar/index.js",
      "components/live/binder.js",
      "components/narrow/index.js",
    ),
    "../narrow",
  );
});

test("a bare directory specifier with a trailing slash keeps the slash", () => {
  assert.equal(
    newSpecifier("./narrowbar/", "components/narrowbar/index.js", "components/binder.js", "x/index.js"),
    "../x/",
  );
});

test("a bare directory specifier becomes a file path when the index is renamed", () => {
  assert.equal(
    newSpecifier(
      "./narrowbar",
      "components/narrowbar/index.js",
      "components/binder.js",
      "components/narrowbar/main.js",
    ),
    "./narrowbar/main.js",
  );
});

test("a bare directory specifier becomes a file path when the index shares the importer's directory", () => {
  assert.equal(
    newSpecifier(
      "./narrowbar",
      "components/narrowbar/index.js",
      "components/narrowbar/binder.js",
      "components/narrowbar/index.js",
    ),
    "./index.js",
  );
});

test("a bare directory specifier becomes a file path when the index sits in an ancestor of the importer", () => {
  assert.equal(newSpecifier("./lib", "lib/index.js", "lib/deep/binder.js", "lib/index.js"), "../index.js");
});
