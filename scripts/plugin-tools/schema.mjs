import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { manifestV2Schema } from "@artemis/plugin-contract";
await writeFile(
  new URL(
    "../../packages/plugin-contract/dist/manifest-v2.schema.json",
    import.meta.url,
  ),
  JSON.stringify(z.toJSONSchema(manifestV2Schema), null, 2) + "\n",
);
