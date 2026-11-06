export interface SkillsApi {
  searchSkillCatalog(query: string): Promise<SkillCatalogItem[]>;
  listInstalledSkills(): Promise<InstalledSkill[]>;
  installSkillCatalog(
    skillId: string,
    operationId: string,
  ): Promise<InstalledSkill>;
  installLocalSkill(operationId: string): Promise<InstalledSkill | undefined>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<InstalledSkill[]>;
  removeSkill(skillId: string): Promise<InstalledSkill[]>;
}

export interface SkillCatalogItem {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  installed: boolean;
  sourceUrl?: string;
  catalogUrl?: string;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  source?: string;
  installedAt?: string;
}
