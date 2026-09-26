// Flat config: recommended correctness rules plus an explicit complexity
// ceiling. The CLI is plain node ES modules with no build step.
import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import oneAssertionPerTest from "./eslint-rules/one-assertion-per-test.js";
import assertionShape from "./eslint-rules/assertion-shape.js";

const RULES = {
  complexity: ["error", 10],
  "max-depth": ["error", 4],
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-var": "error",
  "prefer-const": "error",
  "no-console": ["error", { allow: ["warn", "error"] }],
  "max-params": ["error", 4],
  "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
  "no-else-return": "error",
  "consistent-return": "error",
  "no-shadow": "error",
  "no-unused-private-class-members": "error",
  // Cognitive complexity catches the deeply-nested-but-linear functions that
  // cyclomatic complexity scores as cheap.
  "sonarjs/cognitive-complexity": "error",
  "sonarjs/no-identical-functions": "error",
  // `!(a === b)` and friends: the negation reads as a claim about the whole
  // expression when it is really one about the operator.
  "sonarjs/no-inverted-boolean-check": "error",
  // `^a|b$` binds looser than it reads: the alternation splits the whole
  // pattern, so only one branch is anchored.
  "sonarjs/anchor-precedence": "error",
  // A character class listing the same character twice.
  "sonarjs/duplicates-in-character-class": "error",
  // Backtracking that goes super-linear on input length, enforced everywhere,
  // tests included.
  "sonarjs/super-linear-regex": "error",
};

const PLUGINS = { sonarjs };

// Every exported function and class carries a block saying what it does, and
// the block has to say something: an empty /** */ fails require-description.
// Type-carrying rules stay off: tsc --checkJs reads the @param/@returns types
// and checks the call sites against them.
//
// require-jsdoc's `publicOnly` scopes it to the exported surface;
// require-description has no such option, so its `contexts` list spells out the
// export shapes and both rules police the same symbols.
const JSDOC_RULES = {
  "jsdoc/require-jsdoc": [
    "error",
    {
      publicOnly: true,
      require: {
        FunctionDeclaration: true,
        ClassDeclaration: true,
        MethodDefinition: true,
        ArrowFunctionExpression: true,
        FunctionExpression: true,
      },
    },
  ],
  "jsdoc/require-description": [
    "error",
    {
      contexts: [
        "ExportNamedDeclaration > FunctionDeclaration",
        "ExportDefaultDeclaration > FunctionDeclaration",
        "ExportNamedDeclaration > ClassDeclaration",
        "ExportDefaultDeclaration > ClassDeclaration",
        "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
        "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression",
        "ExportDefaultDeclaration > ArrowFunctionExpression",
        "ExportDefaultDeclaration > FunctionExpression",
        "ExportNamedDeclaration > ClassDeclaration MethodDefinition",
        "ExportDefaultDeclaration > ClassDeclaration MethodDefinition",
      ],
    },
  ],
};

const NODE = { ecmaVersion: 2022, sourceType: "module", globals: globals.node };

export default [
  {
    ignores: ["node_modules/**", ".venv/**", "coverage/**", ".triviajudge/**", "tests/corpus/**"],
  },
  js.configs.recommended,
  {
    files: ["bin/**/*.js", "src/**/*.js", "scripts/**/*.js"],
    languageOptions: NODE,
    plugins: PLUGINS,
    rules: RULES,
  },
  {
    // The suite runs under node's built-in runner; the two local rules enforce
    // docs/testing.md rule 2 and the assertion shapes it names.
    files: ["tests/**/*.js"],
    languageOptions: NODE,
    plugins: {
      ...PLUGINS,
      jsmover: {
        rules: {
          "one-assertion-per-test": oneAssertionPerTest,
          "assertion-shape": assertionShape,
        },
      },
    },
    rules: {
      ...RULES,
      "jsmover/one-assertion-per-test": "error",
      "jsmover/assertion-shape": "error",
    },
  },
  {
    // Production JS: the CLI and the local eslint rules. tests/ is absent.
    files: ["bin/**/*.js", "src/**/*.js", "scripts/**/*.js", "eslint-rules/**/*.js"],
    plugins: { jsdoc },
    rules: JSDOC_RULES,
  },
  {
    files: ["eslint.config.js", "eslint-rules/**/*.js"],
    languageOptions: NODE,
  },
];
