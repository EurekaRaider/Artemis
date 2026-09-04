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
  return <StandardEnvironmentIcon {...props} name="changes" size={20} />;
}

export function EnvironmentLocalIcon(props: IconProps) {
  return <StandardEnvironmentIcon {...props} name="local" size={20} />;
}

export function EnvironmentCommitIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <path d="M3.5 12h5M15.5 12h5" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </EnvironmentGitIcon>
  );
}

export function EnvironmentGithubIcon(props: IconProps) {
  return (
    <EnvironmentGitIcon {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <circle cx="8" cy="9" r="1.75" />
      <circle cx="16" cy="15" r="1.75" />
      <path d="M8 10.75v1.5A2.75 2.75 0 0 0 10.75 15h3.5" />
      <path d="M8 7.25V6.5M16 17.5v.75" />
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
