import { parse as acornParse } from "acorn";
import { jsdocSites } from "./jsdoc.js";

/** @typedef {import("./jsdoc.js").Site} Site */
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
 * Return a file's specifier sites: static imports, `export ... from`,
 * string-literal `import()` and `require()`, and `import("...")` references in
 * comments. An `import()` or `require()` whose argument is not a string literal
 * goes to `unresolvable`, with the offsets and text of the whole argument.
 * @param {string} file root-relative path
 * @param {string} text the file's text
 * @returns {{ sites: Site[], unresolvable: Site[] }} literal sites and non-literal ones
 * @throws {ParseError} when the text fails both the module and the script parse
 */
export function parse(file, text) {
  const { program, comments } = parseEither(file, text);
  /** @type {Site[]} */
  const sites = [];
  /** @type {Site[]} */
  const unresolvable = [];
  walk(program, (node) => {
    const found = specifierOf(node);
    if (!found) return;
    const { kind, arg } = found;
    const line = /** @type {import("acorn").SourceLocation} */ (arg.loc).start.line;
    if (isStringLiteral(arg)) {
      const start = arg.start + 1;
      sites.push({ file, start, end: arg.end - 1, text: text.slice(start, arg.end - 1), line, kind });
    } else {
      unresolvable.push({ file, start: arg.start, end: arg.end, text: text.slice(arg.start, arg.end), line, kind });
    }
  });
  sites.push(...jsdocSites(file, comments, text));
  return { sites, unresolvable };
}
