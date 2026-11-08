// CI lint profile: the project config, minus formatting, with the existing
// backlog rules (mostly `any`) reported as warnings instead of failures.
// Every other rule (hooks order, restricted imports, real bugs) fails CI.
// Tighten by moving a rule back to "error" once its backlog is cleared.
import tseslint from "typescript-eslint";
import base from "./eslint.config.js";

export default tseslint.config(...base, { rules: { "prettier/prettier": "off" } }, {
  files: ["**/*.{ts,tsx}"],
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "no-useless-escape": "warn",
    "no-control-regex": "warn",
    "@typescript-eslint/no-unused-expressions": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
  },
});
