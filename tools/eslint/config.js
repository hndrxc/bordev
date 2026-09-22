import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceExtensions = '{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
const testFiles = `**/*.{test,spec}.${sourceExtensions}`;
const boundaryMessage =
  'Simulation and data must stay independent of Babylon, React, and browser application layers.';

// Match package roots/subpaths, src/ and @/ paths, and any number of ../ hops.
// Keep sim/ and data/ paths unrestricted, including imports between those layers.
const restrictedImports = String.raw`^(?:@babylonjs/|react(?:-dom)?(?:/|$)|(?:src/|@/|(?:\.\.?/)+(?:src/)?)(?:render|ui|input|game|app)(?:/|\.|$))`;
// ESQuery needs Unicode-escaped slashes inside attribute regular expressions.
const restrictedSelector = restrictedImports.replaceAll(
  '/',
  String.raw`\u002F`,
);

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: [`src/**/*.${sourceExtensions}`],
    ignores: ['src/{sim,data}/**', testFiles],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      '*.{js,mjs,cjs,ts,mts,cts}',
      `tools/**/*.${sourceExtensions}`,
      `tests/**/*.${sourceExtensions}`,
      testFiles,
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: [`src/{sim,data}/**/*.${sourceExtensions}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: restrictedImports,
              caseSensitive: true,
              message: boundaryMessage,
            },
          ],
        },
      ],
      // The import rule covers static imports/re-exports, not import() expressions.
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/${restrictedSelector}/]`,
          message: boundaryMessage,
        },
        {
          selector: `ImportExpression > TemplateLiteral > TemplateElement[value.cooked=/${restrictedSelector}/]`,
          message: boundaryMessage,
        },
        {
          selector: `TSImportType[source.value=/${restrictedSelector}/]`,
          message: boundaryMessage,
        },
      ],
    },
  },
]);
