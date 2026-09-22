import { verifySlackCliRelease } from "./slack-cli-release.mjs";

const lock = await verifySlackCliRelease();
console.log(
  `Slack CLI v${lock.version}: latest stable release and all three official archive digests verified.`,
);
