import type {
  ReviewMutationInput,
  ReviewQuery,
  ReviewScope,
} from "@artemis/protocol";

export interface ReviewApi {
  getReviewDiff(query: ReviewQuery): Promise<ReviewDiff>;
  mutateReviewDiff(input: ReviewMutationInput): Promise<ReviewMutationResult>;
  listReviewComments(threadId: string): Promise<ReviewComment[]>;
  addReviewComment(input: AddReviewCommentInput): Promise<ReviewComment>;
  deleteReviewComment(threadId: string, commentId: string): Promise<void>;
}

export interface ReviewHunk {
  id: string;
  header: string;
  additions: number;
  deletions: number;
  lines: ReviewLine[];
}

export interface ReviewLine {
  id: string;
  kind: "context" | "addition" | "deletion";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ReviewCommentAnchor {
  scope: ReviewScope;
  lineId: string;
  path: string;
  kind: ReviewLine["kind"];
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ReviewComment extends ReviewCommentAnchor {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddReviewCommentInput extends ReviewQuery {
  lineId: string;
  body: string;
}

export interface ReviewFile {
  id: string;
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  hunks: ReviewHunk[];
}

export interface ReviewDiff {
  scope: ReviewScope;
  text: string;
  available: boolean;
  files: ReviewFile[];
  baseRef?: string;
  message?: string;
}

export interface UndoTurnChangesResult {
  turnId: string;
  restoredFiles: string[];
  recoveryPath: string;
}

export interface ReviewMutationResult {
  recoveryPath?: string;
}
