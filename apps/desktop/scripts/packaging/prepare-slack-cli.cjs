exports.default = async function prepareSlackCli(context) {
  const { Arch } = require("builder-util");
  const { verifySlackCliRelease } =
    await import("../../../../scripts/slack/slack-cli-release.mjs");
  const { stageSlackCli } =
    await import("../../../../scripts/slack/slack-cli-package.mjs");
  await stageSlackCli(
    `${context.electronPlatformName}-${Arch[context.arch]}`,
    await verifySlackCliRelease(),
  );
};
