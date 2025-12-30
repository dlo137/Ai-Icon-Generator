const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add resolver configuration for Supabase and Node.js compatibility
config.resolver.alias = {
  ...config.resolver.alias,
  'crypto': 'react-native-crypto-js',
  'stream': 'readable-stream',
  'url': 'react-native-url-polyfill',
  'buffer': '@craftzdog/react-native-buffer',
  'events': 'events',
  // Replace ws package with our mock
  'ws': path.resolve(__dirname, 'MockWebSocket.ts'),
  // Add React JSX runtime aliases
  'react/jsx-runtime': 'react/jsx-runtime',
  'react/jsx-dev-runtime': 'react/jsx-dev-runtime',
  // Add semver subpath exports aliases
  'semver/functions/satisfies': path.resolve(__dirname, 'node_modules/semver/functions/satisfies.js'),
  'semver/functions/prerelease': path.resolve(__dirname, 'node_modules/semver/functions/prerelease.js'),
};

// Add node_modules resolution for polyfills
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];

// Disable package exports as it can cause dependency resolution issues
// config.resolver.unstable_enablePackageExports = true;

// Exclude problematic packages
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];
config.resolver.platforms = ['native', 'ios', 'android', 'web'];

// Add source extensions to help with resolution
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs'];

// Configure transformer to handle Node.js modules
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

module.exports = config;