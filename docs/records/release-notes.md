# Artemis v2.0.16

## 中文

- 上下文压缩提示会保留在时间线中实际发生的位置。新消息排在提示之后，重新打开会话时也保持这个顺序。
- 会话太短时，时间线显示“当前会话太短，无需压缩”。其他压缩错误仍会显示具体原因。

## English

- Context compaction notices stay where they occurred in the timeline. New messages appear below them, including when you reopen the conversation.
- When a conversation is too short to need compaction, Artemis shows an informational message. Other compaction failures still show the original error.
