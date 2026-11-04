// Expo's default Metro config plus Sentry debug IDs, which tie each bundle to its uploaded
// source maps (see app.config.ts) so crash reports show real file and line numbers.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
