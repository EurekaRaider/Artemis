const packageJson = require("../package.json");

module.exports = {
  ...packageJson.build,
  afterPack: "scripts/apply-engineering-package-permissions.cjs",
  mac: {
    ...packageJson.build.mac,
    icon: "build/icon.icns",
    identity: null,
  },
};
