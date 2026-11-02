import { ArtemisIcon } from "@artemis/ui/icons";

export function CommandArtwork({
  command,
}: {
  command: "goal" | "compact" | "init" | "plan" | "work" | "codemode";
}) {
  const icons = {
    goal: "target",
    compact: "layers",
    init: "file",
    plan: "plan",
    work: "work",
    codemode: "code",
  } as const;
  return <ArtemisIcon name={icons[command]} width={14} height={14} />;
}
