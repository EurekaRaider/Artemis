import { useState } from "react";

import type { ReviewScope } from "../../../shared/api.js";

export function useReviewSelection() {
  const [reviewScope, setReviewScope] = useState<ReviewScope>("branch");
  const [reviewTurnId, setReviewTurnId] = useState<string>();
  const [environmentCommitRequest, setEnvironmentCommitRequest] = useState(0);
  const [reviewBaseRef, setReviewBaseRef] = useState("");
  const [reviewFileQuery, setReviewFileQuery] = useState("");
  const [selectedReviewFilePath, setSelectedReviewFilePath] =
    useState<string>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  return {
    reviewScope,
    setReviewScope,
    reviewTurnId,
    setReviewTurnId,
    environmentCommitRequest,
    setEnvironmentCommitRequest,
    reviewBaseRef,
    setReviewBaseRef,
    reviewFileQuery,
    setReviewFileQuery,
    selectedReviewFilePath,
    setSelectedReviewFilePath,
    reviewBusy,
    setReviewBusy,
    reviewRefreshing,
    setReviewRefreshing,
  };
}
