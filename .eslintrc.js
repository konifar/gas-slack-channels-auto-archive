module.exports = {
  extends: ["eslint:recommended"],
  env: {
    browser: true,
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  overrides: [
    {
      files: ["**/*.ts"],
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier",
      ],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        sourceType: "module",
        project: "./tsconfig.json",
      },
      plugins: ["@typescript-eslint", "import"],
      rules: {
        "no-unused-vars": "off",
        "import/order": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { varsIgnorePattern: "testPost" },
        ],
      },
    },
  ],
};
