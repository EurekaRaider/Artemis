import { type ImStatus } from "@artemis/protocol";
import type { imNativeGroupChoices } from "../ImNativeGroups";

export type Status = ImStatus & { spaces?: unknown[]; connections?: unknown[] };

export type GroupChoice = ReturnType<typeof imNativeGroupChoices>[number];
