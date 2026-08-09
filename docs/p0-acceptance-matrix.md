# P0 acceptance matrix

Status values: `PASS`, `PARTIAL`, `TODO`, `BLOCKED`.

| ID           | Contract                                             | Windows x64 | macOS arm64 | macOS x64 | Evidence / blocker                                   |
| ------------ | ---------------------------------------------------- | ----------- | ----------- | --------- | ---------------------------------------------------- |
| PROTO-001    | Versioned event schema validates envelopes           | PASS        | PASS        | PASS      | Platform-neutral unit tests                          |
| PROTO-002    | Text/thinking deltas merge in first-seen order       | PASS        | PASS        | PASS      | Reducer tests                                        |
| PROTO-003    | Replayed event IDs are idempotent                    | PASS        | PASS        | PASS      | Reducer tests                                        |
| PI-001       | Pi events are isolated behind `PiAdapter`            | PASS        | PASS        | PASS      | Adapter tests                                        |
| PI-002       | Pi SDK runs in Electron utility process              | PASS        | TODO        | TODO      | Windows smoke process started                        |
| PI-003       | Existing Pi provider can complete a real turn        | TODO        | TODO        | TODO      | Requires configured test credentials                 |
| MODE-001     | Plan rejects writes before filesystem execution      | PASS        | PASS        | PASS      | Policy tests                                         |
| MODE-002     | Review rejects writes before filesystem execution    | PASS        | PASS        | PASS      | Policy tests                                         |
| MODE-003     | Execute write creates an approval request            | PASS        | PASS        | PASS      | Broker and policy tests; model E2E pending           |
| APPROVAL-001 | Nonce decisions are single-use and scope constrained | PASS        | PASS        | PASS      | Approval registry and protocol tests                 |
| APPROVAL-002 | Exact-target task/project grants persist             | PASS        | TODO        | TODO      | Windows SQLite persistence tests                     |
| RECOVERY-001 | Interrupted turns and approvals recover replayably   | PASS        | TODO        | TODO      | Windows SQLite restart tests                         |
| PATH-001     | `..` cannot escape the workspace                     | PASS        | PASS        | PASS      | Platform tests                                       |
| PATH-002     | Junction/symlink cannot escape the workspace         | PASS        | PASS        | PASS      | Platform tests                                       |
| DATA-001     | Projects/tasks/events persist in SQLite WAL          | PASS        | TODO        | TODO      | Windows SQLite restore test                          |
| DATA-002     | Pi session file is retained for resume               | PASS        | PASS        | PASS      | Agent Host restart/resume/fork JSONL test            |
| UI-001       | Sandboxed renderer and typed preload bridge          | PASS        | PASS        | PASS      | Build configuration                                  |
| UI-002       | Project/task/sidebar/composer/review layout renders  | PASS        | TODO        | TODO      | Windows smoke screenshot                             |
| UI-003       | UI follows system English/Chinese                    | PASS        | TODO        | TODO      | Windows en/zh-CN screenshot matrix                   |
| REVIEW-001   | Unstaged Git diff is visible                         | PASS        | TODO        | TODO      | Structured Git review tests                          |
| REVIEW-002   | Last-turn/staged/base scopes                         | PASS        | TODO        | TODO      | Windows real-repository tests                        |
| REVIEW-003   | File/hunk stage/unstage/revert                       | PASS        | TODO        | TODO      | Stale-ID checks and recoverable revert tests         |
| REVIEW-004   | Inline Review comments                               | PASS        | TODO        | TODO      | Stable line anchors, SQLite restart, Renderer UI     |
| TERM-001     | User-opened PTY inherits desktop user permissions    | PASS        | PARTIAL     | PARTIAL   | Windows real PTY access test; macOS host pending     |
| WIN-SBX-001  | AppContainer/restricted token + Job Object           | PASS        | N/A         | N/A       | Real MCP/extension boundary tests                    |
| MAC-SBX-001  | Seatbelt profile denies paths/network                | N/A         | PARTIAL     | PARTIAL   | Profiles tested; real macOS gate is implemented      |
| WORKTREE-001 | Managed detached worktree and handoff                | PASS        | TODO        | TODO      | Windows Git lifecycle and conflict tests             |
| WORKTREE-002 | Branchize, snapshot, restore, and safe cleanup       | PASS        | TODO        | TODO      | Collision-safe Windows restore and rollback tests    |
| WORKTREE-003 | Permanent worktree import and restore UI             | PASS        | TODO        | TODO      | Windows real-repository tests                        |
| EXT-001      | Executable extensions disabled by default            | PASS        | PASS        | PASS      | `noExtensions: true`                                 |
| EXT-002      | Explicit trust enables inventoried extension         | PASS        | PARTIAL     | PARTIAL   | Windows real Pi tool test; macOS host pending        |
| MCP-001      | MCP connections and OAuth are manageable             | PASS        | PASS        | PASS      | stdio/HTTP, OAuth state, PKCE, encrypted token tests |
| AGENT-001    | 64-member tree uses bounded active concurrency       | PASS        | PARTIAL     | PARTIAL   | Tree/scheduler tests; native stress pending          |
| DIAG-001     | Crashes export as a local redacted diagnostic bundle | PASS        | PASS        | PASS      | Bounded persistence, gzip, secret/path redaction     |
| A11Y-001     | English/Chinese at 100/125/150% pass UI audit        | PASS        | TODO        | TODO      | Six Windows screenshots; 0 issues in each audit      |
| PKG-001      | Unsigned engineering package builds                  | PASS        | TODO        | TODO      | Windows install/launch/uninstall + screenshot smoke  |
| PKG-002      | Signed/notarized public artifacts                    | BLOCKED     | BLOCKED     | BLOCKED   | Certificates and release CI required                 |
| UPDATE-001   | Signed update and rollback                           | BLOCKED     | BLOCKED     | BLOCKED   | Code complete; signed feed/cert validation pending   |
| SEC-001      | Production dependency audit has no high/critical     | BLOCKED     | BLOCKED     | BLOCKED   | Pi 0.83.0, MCP SDK and transitive advisories         |

Windows protocol tests do not count as native macOS evidence. All `TODO` and
`BLOCKED` Must rows must be closed before describing the repository as Beta.
