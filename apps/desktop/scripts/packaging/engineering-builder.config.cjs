const packageJson = require("../../package.json");

module.exports = {
  ...packageJson.build,
  publish: null,
  afterPack: "scripts/packaging/apply-engineering-package-permissions.cjs",
  mac: {
    ...packageJson.build.mac,
    icon: "build/icon.icns",
    identity: null,
  },
};
