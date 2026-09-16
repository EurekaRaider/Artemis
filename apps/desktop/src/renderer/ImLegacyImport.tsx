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
      <summary>{t("ImLegacyImport.message1")}</summary>
      <p>{t("ImLegacyImport.message2")}</p>
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
        {t("ImLegacyImport.message3")}
      </Button>
      {preview && (
        <>
          <InlineNotice tone="info">
            {preview.legacyBindings === undefined
              ? t("ImLegacyImport.detected", {
                  count: preview.connections.length,
                })
              : t("ImLegacyImport.detectedWithBindings", {
                  count: preview.connections.length,
                  bindings: preview.legacyBindings,
                })}
          </InlineNotice>
          {!!preview.connections.length && (
            <>
              <Select
                label={t("ImLegacyImport.message5")}
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
                  label={t("ImLegacyImport.message6")}
                  type="password"
                  autoComplete="off"
                  value={adminToken}
                  onValueChange={setAdminToken}
                  disabled={busy}
                />
              )}
              <Checkbox
                label={t("ImLegacyImport.message7")}
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
                {t("ImLegacyImport.message8")}
              </Button>
            </>
          )}
        </>
      )}
    </details>
  );
}
