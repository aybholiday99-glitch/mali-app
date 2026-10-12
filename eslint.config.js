const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'releases/**', '.claude/**', 'node_modules/**', 'supabase/.temp/**', 'vendor/node-forge/**'] },
]);
