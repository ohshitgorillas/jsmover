const USAGE = "usage: jsmover mv [--dry-run] <old> <new>\n";

/**
 * Print usage and return the exit status for an invocation with no command.
 * @param {string[]} _argv arguments after the program name
 * @param {{ write(chunk: string): unknown }} stderr where usage is written
 * @returns {number} the process exit status
 */
export function main(_argv, stderr) {
  stderr.write(USAGE);
  return 2;
}
