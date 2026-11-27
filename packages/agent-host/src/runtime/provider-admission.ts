import {
  providerResponseRetryDelayMilliseconds,
  providerRetryDelayMilliseconds,
} from "./stream-health.js";

import { parentConcurrencyLimit } from "./context-metrics.js";

import {
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
} from "@artemis/protocol";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentConcurrencySnapshot } from "./agent-concurrency.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";

export function createProviderBackoffExtension(
  resolveProviderId: () => string | undefined,
  onResponse: (
    providerId: string,
    status: number,
    headers: Record<string, string>,
  ) => void,
): ExtensionFactory {
  return (pi) => {
    pi.on("after_provider_response", (event, ctx) => {
      const providerId = ctx.model?.provider ?? resolveProviderId();
      if (!providerId) return;
      onResponse(providerId, event.status, event.headers);
    });
  };
}

export function createProviderAdmission(
  services: Pick<
    AgentRuntimeDependencies,
    "concurrency" | "codemodeWorkers" | "providerAdmissionBlockedUntil"
  >,
) {
  function setConcurrencyLimit(limit: number): AgentConcurrencySnapshot {
    if (
      !Number.isInteger(limit) ||
      limit < AGENT_CONCURRENCY_MINIMUM ||
      limit > AGENT_CONCURRENCY_MAXIMUM
    ) {
      throw new Error(
        `Agent concurrency limit must be an integer from ${AGENT_CONCURRENCY_MINIMUM} to ${AGENT_CONCURRENCY_MAXIMUM}.`,
      );
    }
    const snapshot = services.concurrency.setLimits(
      limit,
      parentConcurrencyLimit(limit),
    );
    services.codemodeWorkers.refresh();
    return snapshot;
  }

  function concurrencyStatus(): AgentConcurrencySnapshot {
    return services.concurrency.snapshot;
  }

  function applyProviderBackoffDelay(
    providerId: string,
    delay: number | undefined,
  ): void {
    if (delay === undefined || delay <= 0) return;
    services.providerAdmissionBlockedUntil.set(
      providerId,
      Math.max(
        services.providerAdmissionBlockedUntil.get(providerId) ?? 0,
        Date.now() + delay,
      ),
    );
  }

  function recordProviderBackoff(
    providerId: string,
    error: unknown,
    fallbackDelayMilliseconds?: number,
  ): void {
    const delay =
      providerRetryDelayMilliseconds(error) ?? fallbackDelayMilliseconds;
    applyProviderBackoffDelay(providerId, delay);
  }

  function recordProviderResponseBackoff(
    providerId: string,
    status: number,
    headers?: Record<string, string>,
  ): void {
    applyProviderBackoffDelay(
      providerId,
      providerResponseRetryDelayMilliseconds(status, headers),
    );
  }

  async function waitForProviderAdmission(
    providerId: string,
    signal?: AbortSignal,
    cancelled?: () => boolean,
  ): Promise<void> {
    while (true) {
      if (signal?.aborted || cancelled?.()) {
        throw signal?.reason ?? new DOMException("Aborted", "AbortError");
      }
      const blockedUntil =
        services.providerAdmissionBlockedUntil.get(providerId);
      const remaining = (blockedUntil ?? 0) - Date.now();
      if (remaining <= 0) {
        if (
          services.providerAdmissionBlockedUntil.get(providerId) ===
          blockedUntil
        ) {
          services.providerAdmissionBlockedUntil.delete(providerId);
        }
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(250, remaining));
        const abort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }
  const handlers = {
    setConcurrencyLimit,
    concurrencyStatus,
    recordProviderBackoff,
    recordProviderResponseBackoff,
    waitForProviderAdmission,
  };
  return handlers;
}
