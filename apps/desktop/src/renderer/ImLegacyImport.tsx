import { useState } from "react";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { ImTranslate } from "./ImNavigation";

interface Preview {
  legacyBindings?: number;
  connections: Array<{
    importId: string;
    name: string;
    appId: string;
    domain: string;
  }>;
}
export function ImLegacyImport({
  local,
  busy,
  ready,
  run,
  imported,
  t,
}: {
  local: boolean;
  busy: boolean;
  ready: boolean;
  run(action: () => Promise<void>): Promise<boolean>;
  imported(): Promise<void>;
  t: ImTranslate;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [importId, setImportId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [botOpenId, setBotOpenId] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [stopped, setStopped] = useState(false);
  return (
    <details className="im-legacy-import">
      <summary>
        {t("从旧版飞书直连迁移", "Migrate a legacy Feishu connection")}
      </summary>
      <p>
        {t(
          "选择原电脑上的旧版 settings.json 以预览机器人配置。原文件和旧任务会保留，旧绑定、配对码和待审批项不会导入。",
          "Select the legacy settings.json on the original computer to preview bot configurations. Original files and tasks remain; bindings, pairing codes and pending approvals are excluded.",
        )}
      </p>
      <Button
        disabled={busy || !ready}
        onClick={() =>
          void run(async () => {
            const result = (await window.artemis.manageIm({
              action: "preview-legacy",
            })) as Preview | undefined;
            setPreview(result);
            setImportId(result?.connections[0]?.importId ?? "");
            setStopped(false);
          })
        }
      >
        {t("选择旧版设置文件", "Choose legacy settings file")}
      </Button>
      {preview && (
        <>
          <InlineNotice tone="info">
            {t(
              `检测到 ${preview.connections.length} 个机器人配置${preview.legacyBindings === undefined ? "" : `、${preview.legacyBindings} 个旧绑定`}。导入后需要重新配对并授权项目。`,
              `Found ${preview.connections.length} bot configurations${preview.legacyBindings === undefined ? "" : ` and ${preview.legacyBindings} legacy bindings`}. Pair again and grant projects after importing.`,
            )}
          </InlineNotice>
          {!!preview.connections.length && (
            <>
              <Select
                label={t("待导入机器人", "Bot to import")}
                value={importId}
                disabled={busy}
                options={preview.connections.map((c) => ({
                  value: c.importId,
                  label: `${c.name} · ${c.appId} · ${c.domain}`,
                }))}
                onValueChange={setImportId}
              />
              <TextField
                label="Tenant Key"
                value={tenantId}
                onValueChange={setTenantId}
                disabled={busy}
              />
              <TextField
                label="Bot Open ID"
                value={botOpenId}
                onValueChange={setBotOpenId}
                disabled={busy}
              />
              {!local && (
                <TextField
                  label={t(
                    "导入目标 Gateway 管理凭据",
                    "Destination Gateway administrator token",
                  )}
                  type="password"
                  autoComplete="off"
                  value={adminToken}
                  onValueChange={setAdminToken}
                  disabled={busy}
                />
              )}
              <Checkbox
                label={t(
                  "旧版直连已停止；确认将此机器人连接到当前 Gateway",
                  "The legacy connection is stopped; connect this bot to the current Gateway",
                )}
                checked={stopped}
                onCheckedChange={setStopped}
                disabled={busy}
              />
              <Button
                disabled={
                  busy ||
                  !stopped ||
                  !tenantId.trim() ||
                  !botOpenId.trim() ||
                  (!local && !adminToken)
                }
                onClick={() =>
                  void run(async () => {
                    const token = adminToken;
                    setAdminToken("");
                    await window.artemis.manageIm({
                      action: "import-legacy",
                      importId,
                      tenantId: tenantId.trim(),
                      botOpenId: botOpenId.trim(),
                      legacyStopped: true,
                      ...(local ? {} : { adminToken: token }),
                    });
                    setPreview(undefined);
                    setStopped(false);
                    await imported();
                  })
                }
              >
                {t("确认导入并连接", "Import and connect")}
              </Button>
            </>
          )}
        </>
      )}
    </details>
  );
}
