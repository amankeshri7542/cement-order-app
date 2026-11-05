// Expo's default Metro config. It already follows the npm workspace to the hoisted node_modules.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
