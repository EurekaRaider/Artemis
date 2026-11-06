import type {
  InstalledSkill,
  InstalledArtemisPlugin,
  ArtemisPluginMarketplaceState,
  ArtemisPluginMarketplace,
} from "../../shared/api.js";
export const resourceCache: {
  installedSkillsCache: InstalledSkill[] | undefined;
  installedPluginsCache: InstalledArtemisPlugin[] | undefined;
  marketplaceStateCache: ArtemisPluginMarketplaceState | undefined;
  runtimeMarketplaceCache: ArtemisPluginMarketplace | undefined;
  runtimeMarketplaceLoaded: boolean;
} = {
  installedSkillsCache: undefined,
  installedPluginsCache: undefined,
  marketplaceStateCache: undefined,
  runtimeMarketplaceCache: undefined,
  runtimeMarketplaceLoaded: false,
};
export async function loadInstalledSkills(): Promise<InstalledSkill[]> {
  if (!resourceCache.installedSkillsCache) {
    resourceCache.installedSkillsCache =
      await window.artemis.listInstalledSkills();
  }
  return resourceCache.installedSkillsCache;
}
export async function loadInstalledPlugins(): Promise<
  InstalledArtemisPlugin[]
> {
  if (!resourceCache.installedPluginsCache) {
    resourceCache.installedPluginsCache =
      await window.artemis.listArtemisPlugins();
  }
  return resourceCache.installedPluginsCache;
}
