import { ArtemisIcon } from "@artemis/ui/icons";

export function WorkspaceLauncherIcon({
  kind,
}: {
  kind: "review" | "terminal" | "browser" | "files";
}) {
  return (
    <span className="workspace-launcher-icon" data-kind={kind}>
      {kind === "browser" ? (
        <ArtemisIcon height={18} name="browser" width={18} />
      ) : (
        <svg
          aria-hidden="true"
          fill="none"
          height={18}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          width={18}
        >
          {kind === "review" && (
            <>
              <rect height="18" rx="2" width="14" x="5" y="3" />
              <path d="M9 9h6M12 6v6M9 16h6" />
            </>
          )}
          {kind === "terminal" && (
            <>
              <rect height="18" rx="3" width="18" x="3" y="3" />
              <path d="m7 8 4 4-4 4M13 16h4" />
            </>
          )}
          {kind === "files" && (
            <>
              <path d="M8 7V5a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
              <path d="M2 9a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
