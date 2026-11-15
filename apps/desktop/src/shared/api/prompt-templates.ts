export interface PromptTemplateInfo {
  name: string;
  description: string;
  argumentHint?: string;
  scope: "user" | "project";
}
export interface PromptTemplatesApi {
  listPromptTemplates(
    projectId?: string,
    threadId?: string,
  ): Promise<PromptTemplateInfo[]>;
}
