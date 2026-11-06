import { resourceCache } from "../resource-cache.js";

import { labels } from "../resource-presentation.js";

import { officeCopy } from "../../office/office-copy.js";

import { useRef, useState } from "react";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceState,
  InstalledArtemisPlugin,
  InstalledSkill,
  ResourceInstallProgress,
  SkillCatalogItem,
} from "../../../shared/api.js";

interface UseResourceCatalogStateContext {
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
}
export function useResourceCatalogState(
  context: UseResourceCatalogStateContext,
) {
  const { locale } = context;
  const [skillResults, setSkillResults] = useState<SkillCatalogItem[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [marketplaceState, setMarketplaceState] = useState<
    ArtemisPluginMarketplaceState | undefined
  >(resourceCache.marketplaceStateCache);
  const [installedPlugins, setInstalledPlugins] = useState<
    InstalledArtemisPlugin[]
  >([]);
  const localPluginResults = installedPlugins.filter(
    (plugin) => plugin.source.kind === "local",
  );
  const [runtimeMarketplace, setRuntimeMarketplace] = useState<
    ArtemisPluginMarketplace | undefined
  >(resourceCache.runtimeMarketplaceCache);
  const [installProgress, setInstallProgress] =
    useState<ResourceInstallProgress>();
  const [busyId, setBusyId] = useState<string>();
  const [pendingToggleIds, setPendingToggleIds] = useState<Set<string>>(
    new Set(),
  );
  const pendingToggleIdsRef = useRef(new Set<string>());
  const toggleQueueRef = useRef(Promise.resolve());
  const [pendingPackTargets, setPendingPackTargets] = useState<
    Record<string, boolean>
  >({});
  const [operationPending, setOperationPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string>();
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const operationPendingRef = useRef(false);
  const t = labels[locale];
  const office = officeCopy(locale);
  return {
    skillResults,
    setSkillResults,
    installedSkills,
    setInstalledSkills,
    marketplaceState,
    setMarketplaceState,
    installedPlugins,
    setInstalledPlugins,
    localPluginResults,
    runtimeMarketplace,
    setRuntimeMarketplace,
    installProgress,
    setInstallProgress,
    busyId,
    setBusyId,
    pendingToggleIds,
    setPendingToggleIds,
    pendingToggleIdsRef,
    toggleQueueRef,
    pendingPackTargets,
    setPendingPackTargets,
    operationPending,
    setOperationPending,
    searching,
    setSearching,
    message,
    setMessage,
    catalogSearchRef,
    operationPendingRef,
    t,
    office,
  };
}
