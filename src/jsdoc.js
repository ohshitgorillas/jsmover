/** @typedef {{ file: string, start: number, end: number, text: string, line: number, kind: string }} Site */

// One alternative per quote, so each literal's contents stop at its own closing
// quote and a line break ends an unterminated one.
const REFERENCE = /import\(\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*\)/g;

/**
 * The 1-based line holding `offset` in `text`.
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineAt(text, offset) {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) line += 1;
  return line;
}

/**
 * Return the `import("...")` sites inside a file's comments, the JSDoc type
 * reference form, with offsets of each literal's contents between its quotes.
 * @param {string} file root-relative path of the file
 * @param {{ start: number, end: number }[]} comments comment ranges in `text`
 * @param {string} text the file's text
 * @returns {Site[]} one site per string-literal reference, in source order
 */
export function jsdocSites(file, comments, text) {
  /** @type {Site[]} */
  const sites = [];
  for (const comment of comments) {
    const body = text.slice(comment.start, comment.end);
    for (const match of body.matchAll(REFERENCE)) {
      const spec = match[1] ?? match[2];
      const start = comment.start + match.index + match[0].search(/["']/) + 1;
      sites.push({ file, start, end: start + spec.length, text: spec, line: lineAt(text, start), kind: "jsdoc" });
    }
  }
  return sites;
}
