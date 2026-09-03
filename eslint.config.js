const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  { ignores: ['dist/*', 'design/*', '.expo/*', 'node_modules/*'] },
  {
    // The seam that makes "Supabase drops in without touching the UI" a checked
    // property rather than an intention: screens may not reach past the
    // repository interface into a concrete implementation.
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/data/memory/**', '@/data/memory/**', '**/data/supabase/**', '@/data/supabase/**'],
          message:
            'Screens must depend on the RunitRepository interface, never a concrete adapter. ' +
            'The implementation is chosen once, in src/app/_layout.tsx.',
        }],
      }],
    },
  },
];
