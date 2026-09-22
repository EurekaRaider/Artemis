import { resolve } from "node:path";
import { verifyPackagedSlackCli } from "../../../scripts/slack-cli-package.mjs";
import { verifyPackagedSlackCliCompatibility } from "../../../scripts/slack-cli-native-compatibility.mjs";

if (process.argv.length !== 3)
  throw new Error(
    "Usage: node verify-slack-cli-native.mjs <packaged slack-cli directory>",
  );
console.log(
  JSON.stringify(
    await verifyPackagedSlackCli(
      resolve(process.argv[2]),
      `${process.platform}-${process.arch}`,
    ),
  ),
);
console.log(
  await verifyPackagedSlackCliCompatibility(resolve(process.argv[2])),
);
