import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { ReviewApi } from "../../shared/api/review.js";
export const reviewBridge: ReviewApi = {
  getReviewDiff: (query) => ipcRenderer.invoke(IPC.reviewDiff, query),
  mutateReviewDiff: (input) => ipcRenderer.invoke(IPC.reviewMutate, input),
  listReviewComments: (threadId) =>
    ipcRenderer.invoke(IPC.reviewCommentList, threadId),
  addReviewComment: (input) => ipcRenderer.invoke(IPC.reviewCommentAdd, input),
  deleteReviewComment: (threadId, commentId) =>
    ipcRenderer.invoke(IPC.reviewCommentDelete, threadId, commentId),
};
