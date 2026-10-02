import { ArtemisIcon } from "@artemis/ui/icons";
import type { InstalledArtemisPlugin, InstalledSkill } from "../shared/api.js";
import { ResourceAvatar } from "./resource-icons.js";

export function ComposerSkillChip({
  skill,
  plugin,
  removeLabel,
  onRemove,
}: {
  skill: InstalledSkill;
  plugin?: InstalledArtemisPlugin | undefined;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div
      className="composer-resource-chip composer-selected-skill"
      title={skill.name}
    >
      <ResourceAvatar
        kind="skill"
        name={skill.name}
        pluginName={plugin?.name}
        iconDataUrl={plugin?.iconDataUrl}
        brandColor={plugin?.brandColor}
      />
      <span className="composer-resource-name">{skill.name}</span>
      <button
        type="button"
        className="composer-resource-remove"
        aria-label={`${removeLabel}: ${skill.name}`}
        title={removeLabel}
        onClick={onRemove}
      >
        <ArtemisIcon name="close" width={14} height={14} />
      </button>
    </div>
  );
}
