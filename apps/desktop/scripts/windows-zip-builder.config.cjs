const packageJson = require("../package.json");

// Windows uses the signed platform index, independently of electron-updater feeds.
module.exports = {
  ...packageJson.build,
  publish: null,
  forceCodeSigning: false,
};
