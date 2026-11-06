export function safeToolSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
}

export function piToolName(serverId: string, toolName: string): string {
  return `${safeToolSegment(serverId)}_${safeToolSegment(toolName)}`;
}
