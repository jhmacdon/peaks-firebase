const tseslint = require("typescript-eslint");
const importX = require("eslint-plugin-import-x");

module.exports = tseslint.config(
  {
    ignores: ["lib/**/*", "generated/**/*", "eslint.config.js"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "import-x": importX,
    },
    languageOptions: {
      parserOptions: {
        project: ["tsconfig.json"],
        sourceType: "module",
      },
    },
    rules: {
      "import-x/no-unresolved": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  }
);
