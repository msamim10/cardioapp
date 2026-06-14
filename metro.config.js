// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle 3D models as static assets.
// See assets/models/README.md for which model files to drop into the project.
config.resolver.assetExts.push('glb', 'gltf');

module.exports = config;
