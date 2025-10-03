module.exports = {
  parser: &quot;@typescript-eslint/parser&quot;,
  parserOptions: {
    ecmaVersion: &quot;latest&quot;,
    sourceType: &quot;module&quot;,
    project: &quot;./tsconfig.json&quot;
  },
  extends: [
    &quot;eslint:recommended&quot;,
    &quot;@typescript-eslint/recommended&quot;,
    &quot;@typescript-eslint/recommended-requiring-type-checking&quot;
  ],
  plugins: [&quot;@typescript-eslint&quot;],
  rules: {
    &quot;@typescript-eslint/prefer-optional-chain&quot;: &quot;error&quot;,
    &quot;@typescript-eslint/no-unused-vars&quot;: &quot;error&quot;,
    &quot;no-console&quot;: &quot;off&quot;
  },
  env: {
    &quot;browser&quot;: true,
    &quot;es2022&quot;: true,
    &quot;node&quot;: true
  },
  ignorePatterns: [&quot;dist/&quot;]
};