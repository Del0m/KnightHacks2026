const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**'] },
  {
    // Resolve SDK package exports/types (expo-file-system's entrypoint is TypeScript).
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
  },
]);
