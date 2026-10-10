// Exercise specs live in <repo>/specs and are imported by relative path from src/engine/specs.ts,
// so Metro has to watch that folder too.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../specs')];

module.exports = config;
