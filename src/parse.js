import { parse as acornParse } from "acorn";
import { jsdocSites } from "./jsdoc.js";

/**
 * A span of a file's text: `start` and `end` are offsets into the file, `text`
 * is what lies between them and `line` is the line it starts on.
 * @typedef {{ file: string, start: number, end: number, text: string, line: number }} Text
 */
/**
 * A specifier's contents between its quotes, with the form that holds it.
 * @typedef {Text & { kind: string }} Site
 */
/** @typedef {import("acorn").AnyNode} AnyNode */
/** @typedef {import("acorn").Comment} Comment */
/** @typedef {{ pos: number, loc: { line: number, column: number } }} AcornError */

/** A file that fails both the module and the script parse. */
export class ParseError extends Error {
  /**
   * Carry the failing file and the parser's position.
   * @param {string} file root-relative path
   * @param {number} line 1-based line of the parser's error
   * @param {number} column 0-based column of the parser's error
   */
  constructor(file, line, column) {
    super(`${file}:${line}:${column}: parse failed as module and as script`);
    this.name = "ParseError";
    this.code = "PARSE_ERROR";
    this.file = file;
    this.line = line;
    this.column = column;
  }
}

/**
 * @param {unknown} value
 * @returns {value is AnyNode}
 */
function isNode(value) {
  return (
    typeof value === "object" && value !== null && typeof (/** @type {{ type?: unknown }} */ (value).type) === "string"
  );
}

/**
 * Call `visit` on every node under `value`, parents before children.
 * @param {unknown} value
 * @param {(node: AnyNode) => void} visit
 */
function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (isNode(value)) {
    visit(value);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

/**
 * @param {AnyNode} node
 * @returns {boolean}
 */
function isStringLiteral(node) {
  return node.type === "Literal" && typeof node.value === "string";
}

/**
 * The specifier argument a node carries and the site kind it makes, or null
 * for a node that holds no specifier.
 * @param {AnyNode} node
 * @returns {{ kind: string, arg: AnyNode } | null}
 */
function specifierOf(node) {
  switch (node.type) {
    case "ImportDeclaration":
      return { kind: "import", arg: node.source };
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
      return node.source ? { kind: "export", arg: node.source } : null;
    case "ImportExpression":
      return { kind: "dynamic", arg: node.source };
    case "CallExpression":
      if (node.callee.type !== "Identifier" || node.callee.name !== "require") return null;
      return { kind: "require", arg: node.arguments.length === 1 ? node.arguments[0] : node };
    default:
      return null;
  }
}

/**
 * Parse `text` as one source type, collecting its comments.
 * @param {string} text
 * @param {"module" | "script"} sourceType
 * @returns {{ program: AnyNode, comments: Comment[] }}
 */
function attempt(text, sourceType) {
  /** @type {Comment[]} */
  const comments = [];
  const program = acornParse(text, { ecmaVersion: "latest", sourceType, locations: true, onComment: comments });
  return { program, comments };
}

/**
 * Parse as a module, falling back to a script; a file failing both throws a
 * ParseError at the position of whichever parse got further.
 * @param {string} file
 * @param {string} text
 * @returns {{ program: AnyNode, comments: Comment[] }}
 */
function parseEither(file, text) {
  /** @type {AcornError} */
  let moduleError;
  try {
    return attempt(text, "module");
  } catch (error) {
    moduleError = /** @type {AcornError} */ (error);
  }
  try {
    return attempt(text, "script");
  } catch (error) {
    const scriptError = /** @type {AcornError} */ (error);
    const { line, column } = (scriptError.pos > moduleError.pos ? scriptError : moduleError).loc;
    throw new ParseError(file, line, column);
  }
}

/**
 * The line a node or comment starts on.
 * @param {{ loc?: import("acorn").SourceLocation | null }} node
 * @returns {number}
 */
function lineOf(node) {
  return /** @type {import("acorn").SourceLocation} */ (node.loc).start.line;
}

/**
 * A record of `text` between `start` and `end`, starting on `line`.
 * @param {string} file
 * @param {string} text
 * @param {{ start: number, end: number }} range
 * @param {number} line
 * @returns {Text}
 */
function slice(file, text, { start, end }, line) {
  return { file, start, end, text: text.slice(start, end), line };
}

/**
 * Each comment's body: the text after `//`, or between `/*` and its closing mark.
 * @param {string} file
 * @param {string} text
 * @param {Comment[]} comments
 * @returns {Text[]}
 */
function commentBodies(file, text, comments) {
  return comments.map((comment) => {
    const end = comment.type === "Block" ? comment.end - 2 : comment.end;
    return slice(file, text, { start: comment.start + 2, end }, lineOf(comment));
  });
}

/**
 * Return a file's specifier sites: static imports, `export ... from`,
 * string-literal `import()` and `require()`, and `import("...")` references in
 * comments. An `import()` or `require()` whose argument is not a string literal
 * goes to `unresolvable`, with the offsets and text of the whole argument.
 * Every other string literal goes to `strings` and every comment to
 * `comments`, each with the offsets and text of its contents.
 * @param {string} file root-relative path
 * @param {string} text the file's text
 * @returns {{ sites: Site[], unresolvable: Site[], strings: Text[], comments: Text[] }} literal sites, non-literal ones, other string literals and comment bodies
 * @throws {ParseError} when the text fails both the module and the script parse
 */
export function parse(file, text) {
  const { program, comments } = parseEither(file, text);
  /** @type {Site[]} */
  const sites = [];
  /** @type {Site[]} */
  const unresolvable = [];
  /** @type {Text[]} */
  const strings = [];
  /** @type {Set<AnyNode>} */
  const specifiers = new Set();
  walk(program, (node) => {
    if (isStringLiteral(node)) {
      if (!specifiers.has(node))
        strings.push(slice(file, text, { start: node.start + 1, end: node.end - 1 }, lineOf(node)));
      return;
    }
    const found = specifierOf(node);
    if (!found) return;
    const { kind, arg } = found;
    const line = lineOf(arg);
    if (isStringLiteral(arg)) {
      specifiers.add(arg);
      sites.push({ ...slice(file, text, { start: arg.start + 1, end: arg.end - 1 }, line), kind });
    } else {
      unresolvable.push({ ...slice(file, text, arg, line), kind });
    }
  });
  sites.push(...jsdocSites(file, comments, text));
  return { sites, unresolvable, strings, comments: commentBodies(file, text, comments) };
}
