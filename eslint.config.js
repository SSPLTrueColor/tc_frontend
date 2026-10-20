import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Standard Vite React + TypeScript rules. The /template reference copy is not linted.
export default tseslint.config(
  { ignores: ['dist', 'template', 'node_modules', 'netlify'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // Consistency rules: pages use the shared components, never raw controls / tables / "btn" classes.
  // Table exceptions are listed per file on purpose (docs/UX-AUDIT.md): DataGrid and the report table are table engines themselves;
  // the others are line-item editors, print layouts or computed order lists still to be moved onto DataTable.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/components/primitives/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXOpeningElement[name.name='input']", message: 'Use TextField, SearchInput, Checkbox, Switch, Radio, FileInput or ColorInput from components/primitives/controls.' },
        { selector: "JSXOpeningElement[name.name='textarea']", message: 'Use Textarea from components/primitives/controls.' },
        { selector: "JSXAttribute[name.name='className'][value.value=/^btn(\\s|$)/]", message: 'Use Button, IconButton or LinkButton instead of the "btn" class.' },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: [
      'src/components/primitives/**',
      'src/components/resource/DataGrid.tsx',
      'src/components/resource/FormFields.tsx',
      'src/modules/reports/ReportTable.tsx',
      'src/modules/orders/OrderProcessingPage.tsx',
      'src/modules/orders/PaymentSchedulePage.tsx',
      'src/modules/quotations/LinesTable.tsx',
      'src/modules/quotations/QuotationPdfPage.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXOpeningElement[name.name='input']", message: 'Use TextField, SearchInput, Checkbox, Switch, Radio, FileInput or ColorInput from components/primitives/controls.' },
        { selector: "JSXOpeningElement[name.name='textarea']", message: 'Use Textarea from components/primitives/controls.' },
        { selector: "JSXOpeningElement[name.name='table']", message: 'Use Table (static), DataTable (sort / page) or DataGrid (resource lists).' },
        { selector: "JSXAttribute[name.name='className'][value.value=/^btn(\\s|$)/]", message: 'Use Button, IconButton or LinkButton instead of the "btn" class.' },
      ],
    },
  },
);
