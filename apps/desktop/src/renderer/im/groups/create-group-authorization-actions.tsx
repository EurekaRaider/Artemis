import { type Status } from "./group-values.js";

import {
  imConversationKey,
  type ImAuthorizationOperation,
} from "@artemis/protocol";

import {
  createAuthorizationDraft,
  type AuthorizationDraft,
  type AuthorizationTarget,
} from "../im-authorization-draft";

interface CreateGroupAuthorizationActionsContext {
  readonly setDiscard: import("react").Dispatch<
    import("react").SetStateAction<(() => void) | null>
  >;
  readonly draft: AuthorizationDraft | undefined;
  readonly pending: ImAuthorizationOperation | undefined;
  readonly submitting: boolean;
  readonly setDraft: import("react").Dispatch<
    import("react").SetStateAction<AuthorizationDraft | undefined>
  >;
  readonly setError: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setOperation: import("react").Dispatch<
    import("react").SetStateAction<ImAuthorizationOperation | undefined>
  >;
  readonly status: Status;
  readonly view: "group" | "project";
  readonly sending: import("react").RefObject<boolean>;
  readonly command:
    | {
        version: 1;
        operationId: string;
        supersedes?: string | undefined;
        intent: "create" | "edit" | "pause" | "rebind" | "renew" | "restore";
        deviceId: string;
        gatewayUrl: string;
        conversation: {
          connectionId: string;
          id: string;
          kind: "direct" | "group";
          spaceId?: string | undefined;
          spaceRevision?: string | undefined;
        };
        owner: {
          channel: "feishu" | "slack" | "wecom";
          connectionId: string;
          tenantId: string;
          appId: string;
          userId: string;
        };
        name: string;
        projectId: string;
        expectedPolicyVersion: string | null;
        expectedGroupVersion: string | null;
        expectedScopeVersion: string | null;
        expectedDeviceEnabled: boolean;
        expectedImpactVersion: string;
        policy?:
          | {
              approval: "ask" | "automatic";
              mode: "codemode" | "plan" | "work";
              network: boolean;
              shell: boolean;
              expiresAt: number;
            }
          | undefined;
        scope: {
          audience: string;
          revision?: string | undefined;
          contextRevision?: string | undefined;
          confirmedAt?: number | undefined;
          localAccess?: "full" | "project" | undefined;
          readMode?: "project" | "selected" | undefined;
          writeMode?: "project" | "selected" | undefined;
          spaceRevision?: string | undefined;
          filePaths?: string[] | undefined;
          readPaths: string[];
          writePaths: string[];
        };
        fullAccessConfirmed?: boolean | undefined;
        enableService: boolean;
        confirmationFingerprint: string;
      }
    | undefined;
  readonly validCommand: boolean;
  readonly conflict: boolean;
  readonly setSubmitting: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly refresh: () => Promise<void>;
  readonly setSelected: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setRefreshingMembers: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function createGroupAuthorizationActions(
  context: CreateGroupAuthorizationActionsContext,
) {
  const {
    setDiscard,
    draft,
    pending,
    submitting,
    setDraft,
    setError,
    setOperation,
    status,
    view,
    sending,
    command,
    validCommand,
    conflict,
    setSubmitting,
    refresh,
    setSelected,
    setRefreshingMembers,
  } = context;
  function navigate(action: () => void) {
    if (draft?.dirty && !pending && !submitting) setDiscard(() => action);
    else action();
  }
  function change(patch: Partial<AuthorizationDraft>) {
    setDraft(
      (previous) =>
        previous && { ...previous, ...patch, confirmation: "", dirty: true },
    );
  }
  function begin(
    target: AuthorizationTarget | undefined,
    projectId: string,
    intent: AuthorizationDraft["intent"],
    entry: AuthorizationDraft["entry"] = view,
  ) {
    setError("");
    setOperation(undefined);
    setDraft(
      createAuthorizationDraft(
        status.settings,
        target,
        projectId,
        intent,
        entry,
      ),
    );
  }
  async function submit(retry?: ImAuthorizationOperation) {
    if (
      sending.current ||
      (!retry &&
        (!command ||
          !validCommand ||
          conflict ||
          draft?.confirmation !== command.confirmationFingerprint))
    )
      return;
    sending.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = (await window.artemis.manageIm(
        retry
          ? {
              action: "retry-group-authorization",
              operationId: retry.command.operationId,
            }
          : { action: "authorize-group", command: command! },
      )) as ImAuthorizationOperation;
      setOperation(result);
      await refresh();
      if (result.state === "complete") {
        setSelected(imConversationKey(result.command.conversation));
        setDraft(undefined);
        setOperation(undefined);
        if (result.group?.nativeGroup?.enabled) {
          setRefreshingMembers(true);
          try {
            await window.artemis.manageIm({
              action: "refresh-group-members",
              spaceId: result.group.id,
            });
            await refresh();
          } catch (error) {
            // Authorization is already committed; roster refresh is independent.
            setError(String(error));
          } finally {
            setRefreshingMembers(false);
          }
        }
      }
    } catch (e) {
      // Preserve operation ID after a lost IPC reply. Query/retry it before any new command.
      setError(String(e));
      if (command) {
        const latest = await window.artemis
          .getImStatus()
          .catch(() => undefined);
        const recorded = latest?.authorizationOperations?.find(
          (op) => op.command.operationId === command.operationId,
        );
        if (recorded) setOperation(recorded);
      }
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }
  return { navigate, change, begin, submit };
}
