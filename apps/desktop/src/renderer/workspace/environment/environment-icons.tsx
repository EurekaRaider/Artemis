import { ArtemisIcon } from "@artemis/ui/icons";
import {
  EnvironmentBranchIcon as CodexBranchIcon,
  EnvironmentChangesIcon as CodexChangesIcon,
  EnvironmentPullRequestIcon,
} from "../EnvironmentPanelIcons.js";

export function EnvironmentIcon() {
  return <ArtemisIcon height={20} name="layers" width={20} />;
}

export function BranchIcon() {
  return <CodexBranchIcon aria-hidden="true" />;
}

export function ChangesIcon() {
  return <CodexChangesIcon aria-hidden="true" />;
}

export function PushIcon() {
  return <ArtemisIcon name="push" data-environment-tone="mint" />;
}

export function PullRequestIcon() {
  return <EnvironmentPullRequestIcon />;
}
