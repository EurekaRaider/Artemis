const packageJson = require("../package.json");

// Windows distribution is an unsigned, manually replaced ZIP. No updater feed.
module.exports = {
  ...packageJson.build,
  publish: null,
  forceCodeSigning: false,
};
