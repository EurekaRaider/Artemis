import type { ReactNode, SVGProps } from "react";
import { ArtemisIcon, type ArtemisIconName } from "@artemis/ui/icons";

type IconProps = Omit<SVGProps<SVGSVGElement>, "name">;

function StandardEnvironmentIcon({
  name,
  size,
  ...props
}: IconProps & { name: ArtemisIconName; size: 16 | 20 }) {
  return <ArtemisIcon {...props} height={size} name={name} width={size} />;
}

function EnvironmentGitIcon({
  children,
  size = 20,
  ...props
}: IconProps & { children: ReactNode; size?: 16 | 20 }) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function EnvironmentAddIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="plus" size={20} />;
}

export function EnvironmentBranchIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="7.5" r="2" />
      <path d="M6.5 7.5v9" />
      <path d="M17.5 9.5V11a5.5 5.5 0 0 1-5.5 5.5H9" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentChangesIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M12 5v6M9 16h6" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentLocalIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="local" size={20} />;
}

export function EnvironmentCommitIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <path d="M3.5 12h5M15.5 12h5" />
      <circle cx="12" cy="12" r="3.5" />
    </EnvironmentGitIcon>
  );
}

// GitHub's official Octicons mark, scaled uniformly to the shared 24px grid.
// https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg
export function EnvironmentGithubIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <path
        d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"
        fill="currentColor"
        stroke="none"
        transform="scale(1.5)"
      />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentCompareIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <circle cx="6" cy="6" r="1.75" />
      <circle cx="6" cy="18" r="1.75" />
      <circle cx="18" cy="6" r="1.75" />
      <circle cx="18" cy="18" r="1.75" />
      <path d="M6 7.75v8.5M18 7.75v8.5" />
      <path d="M9.25 9.5h5.5M12.75 7.5l2 2-2 2" />
      <path d="M14.75 14.5h-5.5M11.25 12.5l-2 2 2 2" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentPullRequestIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <circle cx="6" cy="5.5" r="1.75" />
      <circle cx="6" cy="18.5" r="1.75" />
      <circle cx="18" cy="5.5" r="1.75" />
      <path d="M6 7.25v9.5M18 7.25v2.25a5.5 5.5 0 0 1-5.5 5.5H9" />
      <path d="m14.25 18 1.75 1.75 3.75-4" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentChevronIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="chevron" size={20} />;
}

export function EnvironmentExternalIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props} size={16}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentSearchIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="search" size={16} />;
}

export function EnvironmentCheckIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="check" size={16} />;
}

export function EnvironmentSourcesIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="source" size={20} />;
}

export function EnvironmentWebIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="web" size={20} />;
}
