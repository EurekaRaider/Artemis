import { type ApprovalGrant, type ApprovalGrantQuery } from "../store-types.js";

import { type ApprovalScope } from "@artemis/protocol";

import type { StoreDependencies } from "./store-dependencies.js";
export function createApprovalRepository(
  services: Pick<StoreDependencies, "database">,
) {
  function saveApprovalGrant(grant: ApprovalGrant): void {
    services.database
      .prepare(
        `INSERT OR IGNORE INTO approval_grants (
          scope, subject_id, operation, fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        grant.scope,
        grant.subjectId,
        grant.operation,
        grant.fingerprint,
        grant.createdAt,
      );
  }

  function findApprovalGrant(
    query: ApprovalGrantQuery,
  ): Exclude<ApprovalScope, "once"> | undefined {
    const row = services.database
      .prepare(
        `SELECT scope FROM approval_grants
         WHERE operation = ? AND fingerprint = ?
           AND (
             (scope = 'session' AND subject_id = ?)
             OR (scope = 'project' AND subject_id = ?)
           )
         ORDER BY CASE scope WHEN 'session' THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(
        query.operation,
        query.fingerprint,
        query.threadId,
        query.projectId,
      ) as { scope: Exclude<ApprovalScope, "once"> } | undefined;
    return row?.scope;
  }
  const handlers = { saveApprovalGrant, findApprovalGrant };
  return handlers;
}
