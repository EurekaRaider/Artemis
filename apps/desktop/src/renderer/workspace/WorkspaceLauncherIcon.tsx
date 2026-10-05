import { ArtemisIcon } from "@artemis/ui/icons";

export function DesignIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 3a9 9 0 1 0 0 18h1.2a2.8 2.8 0 0 0 2.1-4.65 1.2 1.2 0 0 1 .9-1.95H18A3 3 0 0 0 21 11.4 9 9 0 0 0 12 3Z"
        fill="#fde7c5"
        stroke="#b77942"
        strokeWidth="1.3"
      />
      <circle cx="7" cy="12" r="1.7" fill="#f97373" />
      <circle cx="9" cy="7.5" r="1.7" fill="#f5b938" />
      <circle cx="14" cy="7" r="1.7" fill="#47b889" />
      <circle cx="17.5" cy="10.5" r="1.7" fill="#5d9df5" />
    </svg>
  );
}

export function WorkspaceLauncherIcon({
  kind,
}: {
  kind: "review" | "terminal" | "browser" | "files" | "design";
}) {
  return (
    <span className="workspace-launcher-icon" data-kind={kind}>
      {kind === "browser" ? (
        <ArtemisIcon height={18} name="browser" width={18} />
      ) : kind === "design" ? (
        <DesignIcon />
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
