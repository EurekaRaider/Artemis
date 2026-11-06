import { projectFromRow } from "../store-row-codecs.js";

import { type ProjectRow } from "../store-types.js";

import { type Project } from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createProjectRepository(
  services: Pick<
    StoreDependencies,
    "database" | "getProjectByPath" | "getProject"
  >,
) {
  function upsertProject(project: Project): Project {
    services.database
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at,
           hidden = 0`,
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.createdAt,
        project.updatedAt,
      );

    return services.getProjectByPath(project.path) ?? project;
  }

  function removeProject(id: string): void {
    if (!services.getProject(id)) {
      throw new Error(`Project not found: ${id}`);
    }
    const activeThread = services.database
      .prepare(
        `SELECT 1 FROM threads
         WHERE project_id = ? AND status IN ('running', 'waiting-approval')
         LIMIT 1`,
      )
      .get(id);
    if (activeThread) {
      throw new Error("Stop active tasks before removing this project.");
    }
    services.database
      .prepare("UPDATE projects SET hidden = 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    services.database
      .prepare(
        `UPDATE automations
         SET enabled = 0, next_run_at = NULL, updated_at = ?
         WHERE project_id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
  }

  function getProject(id: string): Project | undefined {
    const row = services.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  function getProjectByPath(path: string): Project | undefined {
    const row = services.database
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(path) as ProjectRow | undefined;
    return row ? projectFromRow(row) : undefined;
  }
  const handlers = {
    upsertProject,
    removeProject,
    getProject,
    getProjectByPath,
  };
  return handlers;
}
