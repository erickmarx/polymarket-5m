import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { fixupPluginRules } from "@eslint/compat";
import prettier from "eslint-plugin-prettier";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  ...compat.extends("eslint:recommended"),
  {
    languageOptions: {
      globals: {
        ...globals.node,
        angular: true,
        window: true,
        document: true,
        d3: true,
        error: true,
        toastr: true,
        MqttClient: true,
        history: true,
        swal: true,
        moment: true,
        location: true,
        jquery: true,
      },

      ecmaVersion: "latest",
      sourceType: "commonjs",

      parserOptions: {
        ecmaFeatures: {
          experimentalObjectRestSpread: true,
        },
      },
    },
    plugins: { prettier: fixupPluginRules(prettier) },
    rules: {
      "space-before-function-paren": [
        "warn",
        {
          anonymous: "always",
          named: "never",
          asyncArrow: "ignore",
        },
      ],

      "no-console": 0,
      "comma-dangle": ["warn", "always-multiline"],
      curly: ["warn", "multi-line"],

      "prefer-const": [
        "warn",
        {
          destructuring: "any",
          ignoreReadBeforeAssign: false,
        },
      ],

      semi: ["warn", "always"],
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-undef": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-self-assign": "off",
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "none", caughtErrors: "none" },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-undef": "off", // TypeScript already handles this
    },
  },
  {
    ignores: [
      "cron/not-operating/*",
      "eslint.config.mjs",
      "apiDocs/*",
      "dist/*",
      "**/dist/*",
      "old-api/*",
      ".worktrees/*",
      "src/public/react/static/js/*",
      "scripts/*",
    ],
  },
];
