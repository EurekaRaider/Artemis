import { reviewCommentFromRow } from "../store-row-codecs.js";

import { type ReviewCommentRow } from "../store-types.js";
import { randomUUID } from "node:crypto";

import type {
  ReviewComment,
  ReviewCommentAnchor,
} from "../../../shared/api.js";

import type { StoreDependencies } from "./store-dependencies.js";
export function createReviewRepository(
  services: Pick<
    StoreDependencies,
    "database" | "getThread" | "listReviewComments"
  >,
) {
  function listReviewComments(threadId: string): ReviewComment[] {
    return (
      services.database
        .prepare(
          `SELECT * FROM review_comments
           WHERE thread_id = ?
           ORDER BY created_at ASC`,
        )
        .all(threadId) as unknown as ReviewCommentRow[]
    ).map(reviewCommentFromRow);
  }

  function addReviewComment(
    threadId: string,
    anchor: ReviewCommentAnchor,
    body: string,
  ): ReviewComment {
    if (!services.getThread(threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const normalizedBody = body.trim();
    if (
      !normalizedBody ||
      Buffer.byteLength(normalizedBody, "utf8") > 16 * 1024
    ) {
      throw new Error("Review comment must contain between 1 byte and 16 KiB.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    services.database
      .prepare(
        `INSERT INTO review_comments(
           id, thread_id, scope, line_id, path, kind, line_text,
           old_line, new_line, body, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        threadId,
        anchor.scope,
        anchor.lineId,
        anchor.path,
        anchor.kind,
        anchor.text,
        anchor.oldLine ?? null,
        anchor.newLine ?? null,
        normalizedBody,
        now,
        now,
      );
    return services
      .listReviewComments(threadId)
      .find((comment) => comment.id === id)!;
  }

  function deleteReviewComment(threadId: string, commentId: string): void {
    const result = services.database
      .prepare(
        `DELETE FROM review_comments
         WHERE id = ? AND thread_id = ?`,
      )
      .run(commentId, threadId);
    if (result.changes !== 1) {
      throw new Error("Review comment was not found.");
    }
  }
  const handlers = {
    listReviewComments,
    addReviewComment,
    deleteReviewComment,
  };
  return handlers;
}
