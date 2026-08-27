import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import type {
  ProjectPullRequest,
  ProjectPullRequestCheck,
  ProjectPullRequestCheckStatus,
  ProjectPullRequestLookup,
  ProjectPullRequestState,
} from "../shared/api.js";

const execFileAsync = promisify(execFile);
const GITHUB_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const GITHUB_TIMEOUT_MILLISECONDS = 15_000;
const GITHUB_PULL_REQUEST_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "headRefName",
  "headRefOid",
  "statusCheckRollup",
].join(",");

type ReadOnlyCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<string>;

export interface GitHubPullRequestDependencies {
  runCommand?: ReadOnlyCommand;
}

interface CommandFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function desktopCommandEnvironment(): NodeJS.ProcessEnv {
  if (process.platform === "win32") return { ...process.env };
  const entries = [
    ...(process.env.PATH?.split(delimiter) ?? []),
    join(homedir(), ".local", "bin"),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  return {
    ...process.env,
    PATH: [...new Set(entries)].join(delimiter),
  };
}

function failureText(error: unknown): string {
  const failure = error as CommandFailure;
  return [failure.stderr, failure.stdout, failure.message]
    .filter((part): part is string => typeof part === "string" && Boolean(part))
    .join("\n")
    .trim();
}

async function runReadOnlyCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...desktopCommandEnvironment(),
      GH_PAGER: "cat",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    },
    maxBuffer: GITHUB_OUTPUT_LIMIT_BYTES,
    timeout: GITHUB_TIMEOUT_MILLISECONDS,
    windowsHide: true,
  });
  return stdout;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = source[key];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximumLength
  ) {
    throw new Error(`GitHub CLI returned an invalid ${key}.`);
  }
  return value.trim();
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength
    ? normalized
    : undefined;
}

function httpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`GitHub CLI returned an invalid ${field}.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(`GitHub CLI returned an invalid ${field}.`);
  }
  return url.toString();
}

function optionalHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return httpUrl(value, "check details URL");
  } catch {
    return undefined;
  }
}

export function normalizeProjectPullRequestCheckStatus(
  value: unknown,
): ProjectPullRequestCheckStatus {
  const check = record(value);
  if (!check) return "pending";
  if (check.__typename === "StatusContext") {
    switch (optionalString(check, "state", 40)?.toUpperCase()) {
      case "SUCCESS":
        return "passed";
      case "FAILURE":
      case "ERROR":
        return "failed";
      default:
        return "pending";
    }
  }

  if (optionalString(check, "status", 40)?.toUpperCase() !== "COMPLETED") {
    return "pending";
  }
  switch (optionalString(check, "conclusion", 40)?.toUpperCase()) {
    case "SUCCESS":
      return "passed";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipped";
    case "CANCELLED":
    case "STALE":
      return "cancelled";
    case "ACTION_REQUIRED":
    case "FAILURE":
    case "STARTUP_FAILURE":
    case "TIMED_OUT":
      return "failed";
    default:
      return "pending";
  }
}

function parseCheck(value: unknown): ProjectPullRequestCheck | undefined {
  const check = record(value);
  if (!check) return undefined;
  const statusContext = check.__typename === "StatusContext";
  const name = optionalString(check, statusContext ? "context" : "name", 255);
  if (!name) return undefined;
  const detailsUrl = optionalHttpUrl(
    optionalString(check, statusContext ? "targetUrl" : "detailsUrl", 4096),
  );
  const workflowName = optionalString(check, "workflowName", 255);
  return {
    name,
    status: normalizeProjectPullRequestCheckStatus(check),
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(workflowName ? { workflowName } : {}),
  };
}

export function parseProjectPullRequest(output: string): ProjectPullRequest {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("GitHub CLI returned invalid pull request JSON.");
  }
  const pullRequest = record(value);
  if (!pullRequest) {
    throw new Error("GitHub CLI returned invalid pull request data.");
  }
  const number = pullRequest.number;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error("GitHub CLI returned an invalid pull request number.");
  }
  const state = requiredString(pullRequest, "state", 20).toUpperCase();
  if (!(state === "OPEN" || state === "CLOSED" || state === "MERGED")) {
    throw new Error("GitHub CLI returned an invalid pull request state.");
  }
  if (typeof pullRequest.isDraft !== "boolean") {
    throw new Error("GitHub CLI returned an invalid draft state.");
  }
  const headRefOid = requiredString(pullRequest, "headRefOid", 64);
  if (!/^[a-f\d]{40,64}$/iu.test(headRefOid)) {
    throw new Error("GitHub CLI returned an invalid head commit.");
  }
  const rawChecks = Array.isArray(pullRequest.statusCheckRollup)
    ? pullRequest.statusCheckRollup
    : [];
  return {
    number,
    title: requiredString(pullRequest, "title", 500),
    url: httpUrl(requiredString(pullRequest, "url", 4096), "pull request URL"),
    state: state as ProjectPullRequestState,
    isDraft: pullRequest.isDraft,
    headRefName: requiredString(pullRequest, "headRefName", 255),
    headRefOid,
    checks: rawChecks.slice(0, 200).flatMap((check) => {
      const parsed = parseCheck(check);
      return parsed ? [parsed] : [];
    }),
  };
}

function isNotRepository(error: unknown): boolean {
  return /not a git repository|must be run in a work tree/iu.test(
    failureText(error),
  );
}

function unavailableLookup(
  error: unknown,
): ProjectPullRequestLookup | undefined {
  const failure = error as CommandFailure;
  const detail = failureText(error);
  if (failure.code === "ENOENT") {
    return { status: "unavailable", reason: "gh-not-installed" };
  }
  if (
    /not logged into any github hosts|authentication|gh auth login|bad credentials|http 401/iu.test(
      detail,
    )
  ) {
    return { status: "unavailable", reason: "authentication-required" };
  }
  if (
    /no pull requests found|could not resolve to a pullrequest/iu.test(detail)
  ) {
    return { status: "not-found" };
  }
  return undefined;
}

export async function inspectProjectPullRequest(
  workspace: string,
  dependencies: GitHubPullRequestDependencies = {},
): Promise<ProjectPullRequestLookup> {
  const runCommand = dependencies.runCommand ?? runReadOnlyCommand;
  let root: string;
  try {
    root = (
      await runCommand("git", ["rev-parse", "--show-toplevel"], workspace)
    ).trim();
  } catch (error) {
    if (isNotRepository(error)) return { status: "not-found" };
    throw error;
  }
  if (!root) return { status: "not-found" };

  let branch: string;
  try {
    branch = (
      await runCommand(
        "git",
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        root,
      )
    ).trim();
  } catch {
    return { status: "not-found" };
  }
  if (!branch) return { status: "not-found" };

  let output: string;
  try {
    output = await runCommand(
      "gh",
      ["pr", "view", branch, "--json", GITHUB_PULL_REQUEST_FIELDS],
      root,
    );
  } catch (error) {
    const unavailable = unavailableLookup(error);
    if (unavailable) return unavailable;
    const detail = failureText(error);
    throw new Error(detail || "GitHub pull request lookup failed.");
  }
  const pullRequest = parseProjectPullRequest(output);
  return pullRequest.headRefName === branch
    ? { status: "found", pullRequest }
    : { status: "not-found" };
}
