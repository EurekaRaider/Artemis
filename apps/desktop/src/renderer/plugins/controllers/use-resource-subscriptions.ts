import {
  resourceCache,
  loadInstalledSkills,
  loadInstalledPlugins,
} from "../resource-cache.js";

import { useEffect } from "react";

import type { CapabilityPackStatus } from "@artemis/protocol";

import type {
  ArtemisPluginMarketplace,
  ArtemisPluginMarketplaceState,
  InstalledArtemisPlugin,
  InstalledSkill,
  McpServerStatus,
  ResourceInstallProgress,
} from "../../../shared/api.js";

interface UseResourceSubscriptionsContext {
  readonly setComputerRuntime: import("react").Dispatch<
    import("react").SetStateAction<
      import("@artemis/protocol").ComputerUseRuntimeStatus | undefined
    >
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setOfficePackStatus: import("react").Dispatch<
    import("react").SetStateAction<CapabilityPackStatus | undefined>
  >;
  readonly setOfficeCapabilityInstalled: import("react").Dispatch<
    import("react").SetStateAction<boolean | undefined>
  >;
  readonly setOfficeCapabilityActive: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly hasOfficePlugins: boolean;
  readonly officeCapabilityOpen: boolean;
  readonly officeUpdating: boolean;
  readonly setDesignPackStatus: import("react").Dispatch<
    import("react").SetStateAction<CapabilityPackStatus | undefined>
  >;
  readonly designPackOpen: boolean;
  readonly setMcpServers: import("react").Dispatch<
    import("react").SetStateAction<McpServerStatus[]>
  >;
  readonly setInstalledPlugins: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin[]>
  >;
  readonly setInstalledSkills: import("react").Dispatch<
    import("react").SetStateAction<InstalledSkill[]>
  >;
  readonly settings:
    import("../../../shared/api.js").SettingsSnapshot | undefined;
  readonly setInstallProgress: import("react").Dispatch<
    import("react").SetStateAction<ResourceInstallProgress | undefined>
  >;
  readonly setRuntimeMarketplace: import("react").Dispatch<
    import("react").SetStateAction<ArtemisPluginMarketplace | undefined>
  >;
  readonly applyMarketplaceState: (next: ArtemisPluginMarketplaceState) => void;
}
export function useResourceSubscriptions(
  context: UseResourceSubscriptionsContext,
) {
  const {
    setComputerRuntime,
    setMessage,
    setOfficePackStatus,
    setOfficeCapabilityInstalled,
    setOfficeCapabilityActive,
    hasOfficePlugins,
    officeCapabilityOpen,
    officeUpdating,
    setDesignPackStatus,
    designPackOpen,
    setMcpServers,
    setInstalledPlugins,
    setInstalledSkills,
    settings,
    setInstallProgress,
    setRuntimeMarketplace,
  } = context;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await window.artemis.computerRuntimeStatus?.();
        if (active) setComputerRuntime(status);
      } catch (error) {
        if (active) setMessage(String(error));
      }
    };
    void window.artemis
      .checkComputerRuntimeUpdates?.()
      .then(refresh)
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .officeCapabilityStatus?.()
        .then((status) => {
          if (active) {
            setOfficePackStatus(status);
            setOfficeCapabilityInstalled(status.versions.length > 0);
            setOfficeCapabilityActive(Boolean(status.activeVersion));
          }
        })
        .catch((error: unknown) => {
          if (active) setMessage(String(error));
        });
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [hasOfficePlugins, officeCapabilityOpen, officeUpdating]);

  useEffect(() => {
    let active = true;
    void window.artemis
      .checkOfficeCapabilityUpdates?.()
      .then(() => window.artemis.officeCapabilityStatus())
      .then((status) => {
        if (active) setOfficePackStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Check the signed catalog each time the store opens; polling only reads status.
  useEffect(() => {
    let active = true;
    void window.artemis
      .checkDesignCapabilityUpdates?.()
      .then(() => window.artemis.designCapabilityStatus())
      .then((status) => {
        if (active) setDesignPackStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // 设计插件状态轮询：轻量本地 IPC，跟随窗口焦点刷新。
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .designCapabilityStatus?.()
        .then((status) => {
          if (active) setDesignPackStatus(status);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [designPackOpen]);

  useEffect(() => {
    let mounted = true;
    void window.artemis
      .listMcpServers()
      .then((servers) => {
        if (mounted) setMcpServers(servers);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadInstalledPlugins()
      .then((plugins) => {
        if (mounted) setInstalledPlugins(plugins);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadInstalledSkills()
      .then((skills) => {
        if (mounted) setInstalledSkills(skills);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () =>
      window.artemis.onMcpServerStatus?.((status) => {
        setMcpServers((current) =>
          current.map((server) =>
            server.config.id === status.config.id ? status : server,
          ),
        );
      }),
    [],
  );

  useEffect(() => {
    if (settings) setMcpServers(settings.mcpServers);
  }, [settings]);

  useEffect(
    () =>
      window.artemis.onResourceInstallProgress((progress) => {
        setInstallProgress((current) =>
          current?.operationId === progress.operationId ? progress : current,
        );
      }),
    [],
  );

  useEffect(() => {
    let mounted = true;
    const marketplaceRequest = resourceCache.marketplaceStateCache
      ? Promise.resolve(resourceCache.marketplaceStateCache)
      : window.artemis.getArtemisPluginMarketplaces();
    const runtimeRequest = resourceCache.runtimeMarketplaceLoaded
      ? Promise.resolve(resourceCache.runtimeMarketplaceCache)
      : window.artemis.loadBundledPluginMarketplace();
    void runtimeRequest
      .then((runtime) => {
        resourceCache.runtimeMarketplaceLoaded = true;
        resourceCache.runtimeMarketplaceCache = runtime;
        if (!mounted) return;
        setRuntimeMarketplace(runtime);
      })
      .catch((error) => {
        if (mounted && !resourceCache.marketplaceStateCache) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    void marketplaceRequest
      .then((next) => {
        if (!mounted) return;
        context.applyMarketplaceState(next);
      })
      .catch((error) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);
  return {};
}
