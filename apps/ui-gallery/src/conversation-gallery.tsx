import {
  ConversationEmptyState,
  ConversationMessage,
  ConversationSurface,
  QueuedMessageGroup,
  QueuedMessageItem,
  TimelineSurface,
  TimelineTurn,
  TimelineViewport,
  TurnChangeSummary,
  TurnExecutionDisclosure,
} from "@artemis/ui/conversation";
import {
  AgentActivity,
  TaskPlan,
  ToolActivity,
  UserInput,
} from "@artemis/ui/patterns";
import { Icon } from "@artemis/ui/actions";

import { GalleryActionIcon } from "./gallery-action-icon.js";

const LONG_RESULT = Array.from(
  { length: 18 },
  (_, index) => `line ${index + 1}: caller-owned output remains scrollable`,
).join("\n");

export function ConversationGallery() {
  return (
    <div className="gallery-conversation-grid">
      <ConversationSurface
        className="gallery-conversation-sample"
        label="Conversation state sample"
      >
        <TimelineViewport label="Conversation history sample">
          <TimelineSurface>
            <TimelineTurn state="running">
              <ConversationMessage
                actions={<button type="button">Edit</button>}
                kind="user"
              >
                Review the migration without changing the protocol or reducer.
              </ConversationMessage>
              <ConversationMessage
                actions={<button type="button">Copy</button>}
                kind="assistant"
                state="streaming"
              >
                <p>
                  The public timeline owns visual anatomy while the consumer
                  continues to own Markdown, links, actions, and streaming data.
                </p>
              </ConversationMessage>
              <ToolActivity
                collapseLabel="Collapse"
                defaultExpanded
                expandLabel="Expand"
                label="Run validation"
                state="failed"
                statusLabel="Failed"
                summary="Run validation"
              >
                <pre>{LONG_RESULT}</pre>
              </ToolActivity>
              <TaskPlan
                collapseLabel="Collapse"
                currentStepId="verify"
                defaultExpanded
                expandLabel="Expand"
                label="Migration plan"
                progressLabel="Step 2 of 3"
                state="active"
                statusLabel="In progress"
                steps={[
                  {
                    id: "inspect",
                    label: "Inspect the current timeline",
                    status: "completed",
                    statusLabel: "Completed",
                  },
                  {
                    id: "verify",
                    label: "Verify state and scroll ownership",
                    status: "in_progress",
                    statusLabel: "In progress",
                  },
                  {
                    id: "merge",
                    label: "Merge after review and CI",
                    status: "pending",
                    statusLabel: "Not started",
                  },
                ]}
                stepsLabel="Conversation migration steps"
              />
              <UserInput
                label="Choose the next action"
                onOptionSelect={() => undefined}
                options={[
                  { id: "review", label: "Review changes" },
                  { id: "continue", label: "Continue migration" },
                ]}
                question="How should the caller continue?"
                selectedOptionId="review"
                state="pending"
                statusLabel="Waiting for input"
              />
              <AgentActivity
                label="Independent reviewer"
                onActivate={() => undefined}
                state="running"
                statusLabel="Reviewing"
                title="Independent reviewer"
              />
            </TimelineTurn>
            <TimelineTurn state="completed">
              <TurnExecutionDisclosure
                label="Worked for 42 seconds"
                summary="Worked for 42 seconds"
              >
                Completed tool and plan activity remains caller-owned.
              </TurnExecutionDisclosure>
              <TurnChangeSummary
                header="2 files changed · +24 −8"
                label="Turn changes"
                state="ready"
              >
                <button type="button">Review changes</button>
              </TurnChangeSummary>
            </TimelineTurn>
          </TimelineSurface>
        </TimelineViewport>
        <QueuedMessageGroup
          heading="2 queued messages"
          label="2 queued messages"
        >
          <QueuedMessageItem
            actions={<button type="button">Edit</button>}
            index={1}
          >
            Add focused Electron coverage
          </QueuedMessageItem>
          <QueuedMessageItem
            actions={<button type="button">Delete</button>}
            index={2}
            state="failed"
          >
            Retry the failed queued edit
          </QueuedMessageItem>
        </QueuedMessageGroup>
      </ConversationSurface>

      <ConversationSurface
        className="gallery-conversation-empty"
        label="Empty conversation sample"
        state="empty"
      >
        <ConversationEmptyState
          icon={
            <Icon size="xl">
              <GalleryActionIcon />
            </Icon>
          }
          label="No conversation messages"
          title="What should we build?"
          detail="Conversation data remains owned by the caller."
        />
      </ConversationSurface>

      <div dir="rtl">
        <ConversationSurface
          className="gallery-conversation-rtl"
          label="RTL conversation sample"
        >
          <TimelineViewport label="RTL conversation history">
            <TimelineSurface>
              <TimelineTurn state="cancelled">
                <ConversationMessage kind="user">
                  رسالة طويلة تظل مقروءة وتحافظ على الهندسة المنطقية من اليمين
                  إلى اليسار
                </ConversationMessage>
                <ConversationMessage kind="assistant" state="failed">
                  تم إيقاف المهمة، وتظل حالة الفشل مرئية بالنص ولا تعتمد على
                  اللون وحده.
                </ConversationMessage>
              </TimelineTurn>
            </TimelineSurface>
          </TimelineViewport>
        </ConversationSurface>
      </div>
    </div>
  );
}
