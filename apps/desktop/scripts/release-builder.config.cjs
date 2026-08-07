const packageJson = require("../package.json");

function publishConfiguration() {
  if (process.env.ARTEMIS_UPDATE_URL) {
    return [
      {
        provider: "generic",
        url: process.env.ARTEMIS_UPDATE_URL,
        channel: process.env.ARTEMIS_UPDATE_CHANNEL || "latest",
      },
    ];
  }
  if (!process.env.ARTEMIS_UPDATE_OWNER || !process.env.ARTEMIS_UPDATE_REPO) {
    return undefined;
  }
  return [
    {
      provider: "github",
      owner: process.env.ARTEMIS_UPDATE_OWNER,
      repo: process.env.ARTEMIS_UPDATE_REPO,
      channel: process.env.ARTEMIS_UPDATE_CHANNEL || "latest",
      releaseType: "draft",
    },
  ];
}

module.exports = {
  ...packageJson.build,
  publish: publishConfiguration(),
  generateUpdatesFilesForAllChannels: true,
  win: {
    ...packageJson.build.win,
    publisherName: process.env.ARTEMIS_WINDOWS_PUBLISHER,
    verifyUpdateCodeSignature: true,
  },
  mac: {
    ...packageJson.build.mac,
    hardenedRuntime: true,
    notarize: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
  },
};
