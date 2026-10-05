import { ArtemisIcon } from "@artemis/ui/icons";
import { Popover, Tooltip } from "@artemis/ui/feedback";
import { Button, IconButton } from "@artemis/ui/actions";
import { TextField, TextAreaField, Select, Checkbox } from "@artemis/ui/forms";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppLocale,
  BrowserElementInspection,
  BrowserPreviewCommand,
  BrowserPreviewSnapshot,
  BrowserViewport,
} from "@artemis/protocol";
import { browserViewportSchema } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";

interface Props {
  threadId?: string | undefined;
  contentsId?: number | undefined;
  tabId: string;
  locale: AppLocale;
  onEvidence(
    text: string,
    image?: { data: string; mimeType: "image/jpeg" },
  ): void;
  enabled?: boolean;
  children: ReactNode;
}
export function BrowserPreviewTools({
  threadId,
  contentsId,
  tabId,
  locale,
  onEvidence,
  children,
  enabled = true,
}: Props) {
  const t = (
    key:
      | "annotate"
      | "responsive"
      | "screenshot"
      | "debug"
      | "fit"
      | "follow"
      | "rotate"
      | "width"
      | "height"
      | "zoom"
      | "clear"
      | "draft"
      | "note"
      | "region"
      | "paused"
      | "all"
      | "errors"
      | "cancel"
      | "select"
      | "resize",
  ) => uiText(locale, `BrowserPreview.${key}`);
  const key = `artemis-browser-preview-v1:${threadId}:${tabId}`;
  const stage = useRef<HTMLDivElement>(null);
  const sizesAnchor = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<BrowserPreviewSnapshot>();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [error, setError] = useState<string>();
  const [sizesOpen, setSizesOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<BrowserElementInspection>();
  const [hovered, setHovered] = useState<BrowserElementInspection>();
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [fit, setFit] = useState(true);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [dimensions, setDimensions] = useState({ width: 1440, height: 1100 });
  const [busy, setBusy] = useState(false);
  const hoverBusy = useRef(false);
  const mounted = useRef(true);
  const targetKey = `${threadId}:${tabId}:${contentsId}`;
  const activeTarget = useRef(targetKey);
  activeTarget.current = targetKey;
  const command = useCallback(
    async (input: BrowserPreviewCommand) => {
      if (!threadId || contentsId === undefined)
        throw new Error("Browser is not ready.");
      const result = await window.artemis.browserPreview(
        threadId,
        contentsId,
        input,
      );
      if (activeTarget.current !== targetKey)
        throw new Error("Browser changed while the operation was running.");
      if (mounted.current) {
        setSnapshot(result);
        setError(undefined);
      }
      return result;
    },
    [threadId, contentsId, targetKey],
  );
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((reason) => {
        if (mounted.current) setError(String(reason));
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };
  const scaleFor = (width: number, height: number) =>
    Math.max(
      0.1,
      Math.min(
        1,
        (stage.current?.clientWidth ?? width) / width,
        (stage.current?.clientHeight ?? height) / height,
      ),
    );
  const setViewport = useCallback(
    async (viewport: BrowserViewport | null, autoFit = fitRef.current) => {
      const next = viewport && {
        ...viewport,
        scale: autoFit
          ? scaleFor(viewport.width, viewport.height)
          : viewport.scale,
      };
      const result = await command({ action: "viewport", viewport: next });
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, viewport: result.viewport, fit: autoFit }),
      );
    },
    [command, key],
  );
  useEffect(() => {
    mounted.current = true;
    if (!enabled || !threadId || contentsId === undefined) return;
    let stopped = false;
    const start = async () => {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved?.version === 1 &&
        saved.viewport &&
        browserViewportSchema.safeParse(saved.viewport).success
      ) {
        setFit(saved.fit !== false);
        setDimensions(saved.viewport);
        await setViewport(saved.viewport, saved.fit !== false);
      }
      if (!stopped) await command({ action: "snapshot" });
    };
    void start().catch((reason) => {
      if (!stopped) setError(String(reason));
    });
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void command({ action: "snapshot" })
        .catch((reason) => {
          if (!stopped) setError(String(reason));
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [command, contentsId, key, setViewport, threadId, enabled]);
  useEffect(() => {
    setPicked(undefined);
    setHovered(undefined);
    setPicking(false);
  }, [snapshot?.navigationId]);
  useEffect(() => {
    if (snapshot?.viewport) setDimensions(snapshot.viewport);
  }, [snapshot?.viewport?.width, snapshot?.viewport?.height]);
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const viewport = snapshotRef.current?.viewport;
      if (!viewport) {
        setDimensions({
          width: Math.round(element.clientWidth),
          height: Math.round(element.clientHeight),
        });
      }
      if (
        viewport &&
        fitRef.current &&
        Math.abs(scaleFor(viewport.width, viewport.height) - viewport.scale) >
          0.01
      )
        void setViewport(viewport, true).catch((reason) =>
          setError(String(reason)),
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [setViewport]);
  useEffect(() => {
    if (!picking) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicking(false);
        setHovered(undefined);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [picking]);
  const inspect = async (x: number, y: number) => {
    const current = snapshotRef.current;
    if (!current) return;
    const scale = current.viewport?.scale ?? 1;
    try {
      return (
        await command({
          action: "inspect",
          x: x / scale,
          y: y / scale,
          navigationId: current.navigationId,
        })
      ).inspection;
    } catch {
      return {
        navigationId: current.navigationId,
        tag: "region",
        attributes: {},
        styles: {},
        regionOnly: true,
        bounds: { x: x / scale, y: y / scale, width: 1, height: 1 },
      } satisfies BrowserElementInspection;
    }
  };
  const sendEvidence = async (element?: BrowserElementInspection) => {
    const result = await command({ action: "screenshot" });
    if (element && element.navigationId !== result.navigationId)
      throw new Error("Page changed. Select the element again.");
    const diagnostics = result.entries.filter((entry) =>
      selected.includes(entry.id),
    );
    const lines: string[] = [];
    if (element || diagnostics.length) {
      lines.push(uiText(locale, "BrowserPreview.evidence"), result.url);
      const viewport = result.viewport ?? dimensions;
      lines.push(`${viewport.width} × ${viewport.height}`);
      if (element) {
        lines.push(
          `${element.tag}${element.attributes.id ? `#${element.attributes.id}` : ""}`,
        );
        const { x, y, width, height } = element.bounds;
        lines.push(
          `${t("region")}: (${Math.round(x)}, ${Math.round(y)}) · ${Math.round(width)} × ${Math.round(height)}`,
        );
      }
      if (note.trim()) lines.push(note.trim());
      lines.push(
        ...diagnostics.map((entry) => `[${entry.level}] ${entry.text}`),
      );
    }
    if (!mounted.current) return;
    onEvidence(lines.join("\n"), result.image);
    setPicked(undefined);
    setNote("");
    setSelected([]);
  };
  const highlight = picked ?? hovered;
  const scale = snapshot?.viewport?.scale ?? 1;
  const fields = () => (
    <div className="browser-preview-dimensions">
      {(["width", "height"] as const).map((dimension) => (
        <TextField
          key={dimension}
          label={t(dimension)}
          type="number"
          size="compact"
          min={dimension === "width" ? 320 : 240}
          max={2560}
          value={String(dimensions[dimension])}
          onValueChange={(value) =>
            setDimensions((current) => ({
              ...current,
              [dimension]: Number(value),
            }))
          }
          onBlur={() => run(() => setViewport({ ...dimensions, scale }))}
        />
      ))}
      <IconButton
        label={t("rotate")}
        title={t("rotate")}
        icon={<ArtemisIcon name="refresh" />}
        disabled={busy}
        onClick={() =>
          run(() =>
            setViewport({
              width: dimensions.height,
              height: dimensions.width,
              scale,
            }),
          )
        }
      />
    </div>
  );
  const preset = !snapshot?.viewport
    ? "follow"
    : dimensions.width === 1440 && dimensions.height === 1100
      ? "desktop"
      : dimensions.width === 390 && dimensions.height === 844
        ? "phone"
        : "custom";
  const zoomControl = () => (
    <Select
      className="browser-preview-zoom"
      label={t("zoom")}
      size="compact"
      value={fit ? "fit" : String(scale)}
      options={[
        { value: "fit", label: t("fit") },
        ...[0.25, 0.5, 0.75, 1, 1.5, 2].map((value) => ({
          value: String(value),
          label: `${value * 100}%`,
        })),
      ]}
      onValueChange={(value) => {
        const autoFit = value === "fit";
        setFit(autoFit);
        run(() =>
          setViewport(
            { ...dimensions, scale: autoFit ? 1 : Number(value) },
            autoFit,
          ),
        );
      }}
    />
  );
  if (!enabled) return <>{children}</>;
  return (
    <div className="browser-preview-tools">
      <div
        className="browser-preview-toolbar browser-preview-main-toolbar"
        role="toolbar"
        aria-label={t("responsive")}
      >
        <Tooltip label={t("annotate")}>
          <IconButton
            label={t("annotate")}
            icon={<ArtemisIcon name="target" />}
            disabled={!snapshot || busy || snapshot.paused}
            selected={picking}
            onClick={() => {
              setPicking(!picking);
              setPicked(undefined);
            }}
          />
        </Tooltip>
        <span className="browser-preview-divider" />
        <Select
          className="browser-preview-preset"
          label={t("responsive")}
          size="compact"
          value={preset}
          disabled={busy}
          options={[
            { value: "follow", label: t("follow") },
            { value: "desktop", label: "1440 × 1100" },
            { value: "phone", label: "390 × 844" },
            { value: "custom", label: t("responsive") },
          ]}
          onValueChange={(value) => {
            if (value === "custom") {
              setSizesOpen(true);
              return;
            }
            run(() =>
              setViewport(
                value === "follow"
                  ? null
                  : {
                      ...(value === "desktop"
                        ? { width: 1440, height: 1100 }
                        : { width: 390, height: 844 }),
                      scale: 1,
                    },
              ),
            );
          }}
        />
        <div className="browser-preview-inline-dimensions">{fields()}</div>
        <div className="browser-preview-size-anchor" ref={sizesAnchor}>
          <IconButton
            label={t("responsive")}
            title={t("responsive")}
            icon={<ArtemisIcon name="settings" />}
            aria-expanded={sizesOpen}
            onClick={() => setSizesOpen(!sizesOpen)}
          />
        </div>
        {zoomControl()}
        <span className="browser-preview-toolbar-spacer" />
        <Tooltip label={t("screenshot")}>
          <IconButton
            label={t("screenshot")}
            icon={<ArtemisIcon name="image" />}
            disabled={!snapshot || busy || snapshot.paused}
            onClick={() => run(() => sendEvidence())}
          />
        </Tooltip>
        <span className="browser-preview-debug-control">
          <Tooltip label={t("debug")}>
            <IconButton
              label={t("debug")}
              icon={<ArtemisIcon name="terminal" />}
              selected={debugOpen}
              onClick={() => setDebugOpen(!debugOpen)}
            />
          </Tooltip>
          {snapshot?.entries.some((entry) => entry.level === "error") && (
            <span className="browser-preview-error-dot" />
          )}
        </span>
      </div>
      <Popover
        className="browser-preview-size-popover"
        anchorRef={sizesAnchor}
        open={sizesOpen}
        onOpenChange={setSizesOpen}
        label={t("responsive")}
      >
        <span className="browser-preview-popover-title">{t("responsive")}</span>
        {fields()}
        <div className="browser-preview-popover-zoom">
          <span>{t("zoom")}</span>
          {zoomControl()}
        </div>
      </Popover>
      {error && (
        <div role="alert" className="browser-preview-error">
          {error}
        </div>
      )}
      {snapshot?.paused && <div role="status">{t("paused")}</div>}
      <div className="browser-preview-stage" ref={stage}>
        {children}
        {picking && (
          <div
            className="browser-preview-picker"
            role="button"
            tabIndex={0}
            aria-label={t("select")}
            onPointerMove={(event) => {
              if (hoverBusy.current) return;
              hoverBusy.current = true;
              const bounds = event.currentTarget.getBoundingClientRect();
              void inspect(
                event.clientX - bounds.left,
                event.clientY - bounds.top,
              )
                .then(setHovered)
                .finally(() => {
                  hoverBusy.current = false;
                });
            }}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              run(async () => {
                setPicked(
                  await inspect(
                    event.clientX - bounds.left,
                    event.clientY - bounds.top,
                  ),
                );
                setPicking(false);
                setHovered(undefined);
              });
            }}
          />
        )}
        {highlight && (
          <div
            className="browser-preview-highlight"
            style={{
              left: highlight.bounds.x * scale,
              top: highlight.bounds.y * scale,
              width: Math.max(4, highlight.bounds.width * scale),
              height: Math.max(4, highlight.bounds.height * scale),
            }}
          />
        )}
        {snapshot?.viewport && (
          <button
            className="browser-preview-resize"
            aria-label={t("resize")}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              const bounds = stage.current!.getBoundingClientRect();
              run(() =>
                setViewport({
                  width: Math.max(
                    320,
                    Math.min(
                      2560,
                      Math.round((event.clientX - bounds.left) / scale),
                    ),
                  ),
                  height: Math.max(
                    240,
                    Math.min(
                      2560,
                      Math.round((event.clientY - bounds.top) / scale),
                    ),
                  ),
                  scale,
                }),
              );
            }}
          >
            ↘
          </button>
        )}
      </div>
      {picked && (
        <div className="browser-preview-annotation">
          <strong>
            {picked.regionOnly
              ? t("region")
              : `${picked.tag} ${picked.attributes.id ?? ""}`}
          </strong>
          <TextAreaField
            label={t("note")}
            placeholder={t("note")}
            value={note}
            onValueChange={setNote}
            maxLength={4000}
          />
          <Button
            disabled={busy}
            onClick={() => run(() => sendEvidence(picked))}
          >
            {t("draft")}
          </Button>
          <Button onClick={() => setPicked(undefined)}>{t("cancel")}</Button>
        </div>
      )}
      {debugOpen && (
        <div className="browser-preview-diagnostics">
          <div className="browser-preview-toolbar">
            <Select
              label={t("debug")}
              value={filter}
              onValueChange={setFilter}
              size="compact"
              options={[
                { value: "all", label: t("all") },
                { value: "console", label: "Console" },
                { value: "network", label: "Network" },
                { value: "error", label: t("errors") },
              ]}
            />
            <Button
              disabled={busy || snapshot?.paused}
              onClick={() => run(() => command({ action: "clear" }))}
            >
              {t("clear")}
            </Button>
            <Button
              disabled={busy || selected.length === 0 || snapshot?.paused}
              onClick={() => run(() => sendEvidence())}
            >
              {t("draft")}
            </Button>
            <Button
              disabled={!snapshot}
              onClick={() => run(() => command({ action: "devtools" }))}
            >
              DevTools
            </Button>
          </div>
          <div className="browser-preview-log" role="log">
            {snapshot?.entries
              .filter(
                (entry) =>
                  filter === "all" ||
                  entry.source === filter ||
                  entry.level === filter,
              )
              .map((entry) => (
                <div key={entry.id} data-level={entry.level}>
                  <Checkbox
                    label={
                      `${entry.text.startsWith("Electron Security Warning (Insecure Content-Security-Policy)") ? uiText(locale, "BrowserPreview.securityWarning") : entry.text}${entry.durationMs !== undefined ? ` · ${entry.durationMs} ms` : ""}` ||
                      entry.source
                    }
                    checked={selected.includes(entry.id)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked
                          ? [...current, entry.id]
                          : current.filter((id) => id !== entry.id),
                      )
                    }
                  />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
