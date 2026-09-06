import { useState } from "react";
import type { ImSettings, ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { diagnosticSchema } from "./ImDiagnostics";
import type { ImTranslate } from "./ImNavigation";

export function ImSavedSpaces({
  spaces,
  settings,
  tasks,
  edit,
  remove,
  canRemove,
  busy,
  t,
}: {
  spaces: unknown[];
  settings: ImSettings;
  tasks: ImStatus["remoteTasks"];
  edit(json: string, confirmation: string): void;
  remove(id: string): Promise<boolean>;
  canRemove: boolean;
  busy: boolean;
  t: ImTranslate;
}) {
  const [removing, setRemoving] = useState("");
  const parsedSpaces = spaces.flatMap((value) => {
    const parsed = diagnosticSchema.shape.spaces.element.safeParse(value);
    return parsed.success
      ? [
          {
            ...parsed.data,
            confirmed:
              !!value &&
              typeof value === "object" &&
              "confirmed" in value &&
              value.confirmed === true,
          },
        ]
      : [];
  });
  const saved = [
    ...new Map(parsedSpaces.map((space) => [space.id, space])).values(),
  ];
  if (!saved.length) return null;
  return (
    <div className="im-field-stack">
      <h4>{t("已保存的协作空间", "Saved collaboration spaces")}</h4>
      {saved.map((space) => {
        const grants = settings.grants.filter(
          (g) =>
            g.expiresAt > Date.now() && g.groups.includes(`space:${space.id}`),
        );
        const conversation = tasks?.find(
          (task) => task.group?.spaceId === space.id,
        );
        return (
          <InlineNotice
            key={space.id}
            tone={space.confirmed ? "info" : "warning"}
          >
            <strong>{space.name}</strong>
            <p>
              {t(
                `${space.endpoints.length} 个群 · ${space.participants.length} 个成员账号`,
                `${space.endpoints.length} groups · ${space.participants.length} member accounts`,
              )}
            </p>
            <p>
              {!space.confirmed
                ? t(
                    "等待各群确认。可以打开已保存配置，重新复制群确认指令。",
                    "Awaiting group confirmations. Open the saved configuration to copy the confirmation command again.",
                  )
                : !grants.length
                  ? t(
                      "各群已确认。请在“项目授权”中允许该空间使用一个项目。",
                      "All groups confirmed. Allow this space to use a project in Project permissions.",
                    )
                  : !settings.enabled
                    ? t(
                        "项目已授权，请启用 IM 连接以同步群协作对话。",
                        "Project authorized. Enable IM to sync the group conversation.",
                      )
                    : conversation
                      ? t(
                          "群协作对话已创建，可在对话列表中打开并输入任务。",
                          "Group conversation created. Open it from the conversation list to enter a task.",
                        )
                      : grants.length > 1 &&
                          !grants.some(
                            (g) => g.projectId === settings.defaultProjectId,
                          )
                        ? t(
                            "该空间获准使用多个项目，请在“项目授权”中选择默认项目后同步对话。",
                            "This space can use multiple projects. Choose a default project in Project permissions to sync its conversation.",
                          )
                        : t(
                            "各群已确认且项目已授权，连接正常时会自动同步到对话列表。",
                            "Groups confirmed and project authorized. The conversation syncs automatically while connected.",
                          )}
            </p>
            <Button
              disabled={busy}
              onClick={() => {
                const { confirmed: _, ...configuration } = space;
                edit(
                  JSON.stringify(configuration, null, 2),
                  `/space-confirm ${space.id}`,
                );
              }}
            >
              {t(
                `打开已保存配置：${space.name}`,
                `Open saved configuration: ${space.name}`,
              )}
            </Button>
            {removing !== space.id ? (
              <Button
                variant="quiet"
                disabled={busy || !canRemove}
                onClick={() => setRemoving(space.id)}
              >
                {t(`删除空间：${space.name}`, `Delete space: ${space.name}`)}
              </Button>
            ) : (
              <div
                role="group"
                aria-label={t(
                  `删除协作空间 ${space.name}`,
                  `Delete collaboration space ${space.name}`,
                )}
              >
                <p>
                  {t(
                    `删除“${space.name}”后，各群将不再通过此空间共享任务或派发给成员。原生 IM 群与已有对话历史保留；正在执行的 IM 任务会在电脑同步后停止。`,
                    `Deleting ${space.name} disconnects task sharing and member delegation through this space. Native IM groups and conversation history remain. Running IM tasks stop when their computers sync.`,
                  )}
                </p>
                <Button
                  disabled={busy || !canRemove}
                  onClick={() => {
                    void remove(space.id).then((removed) => {
                      if (removed) setRemoving("");
                    });
                  }}
                >
                  {t("确认删除空间", "Confirm space deletion")}
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setRemoving("")}
                >
                  {t("取消", "Cancel")}
                </Button>
              </div>
            )}
          </InlineNotice>
        );
      })}
    </div>
  );
}
