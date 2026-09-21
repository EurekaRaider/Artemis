# CI reliability audit — 2026-09-21

The latest failing main run was [35516126166](https://github.com/EurekaRaider/Artemis/actions/runs/35516126166), for `0d7209e1791dd8135187d643130bfd264919f079`.
Its Windows visual, Windows sandbox, and macOS arm64 jobs passed. The two
failures had independent causes:

- The Markdown renderer test required CI and React badges removed by a
  README-only edit. Renderer examples now use fixed input. Tests no longer read the repository
  README, including the release-version check.
- The macOS x64 package scan attempted another Electron download and failed
  with `getaddrinfo ENOTFOUND github.com`. The scan now packages the installed
  Electron distribution already exercised by its native smoke checks. This
  applies only to the host-architecture verification package, not cross-builds
  or release configuration. Initial dependency installation still needs network.

## Recurring failures

| Runs                                                                                                                                                             | Evidence                                                                            | Treatment                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [35453149862](https://github.com/EurekaRaider/Artemis/actions/runs/35453149862), [35512822294](https://github.com/EurekaRaider/Artemis/actions/runs/35512822294) | CSS/source expectations and accessibility evidence no longer matched the changed UI | These checks catch changes in UI contracts. Update intended behavior and its evidence together; do not globally disable the contracts. Later main commits already repaired these failures.                                                                                                                                       |
| [35478491374](https://github.com/EurekaRaider/Artemis/actions/runs/35478491374), [35486744244](https://github.com/EurekaRaider/Artemis/actions/runs/35486744244) | Concurrent Goal smoke renderers exceeded their startup deadline                     | The existing main fix increased the initialization deadline within the aggregate workload budget. It is already present in this repair's base.                                                                                                                                                                                   |
| [35491224206](https://github.com/EurekaRaider/Artemis/actions/runs/35491224206), [35503223593](https://github.com/EurekaRaider/Artemis/actions/runs/35503223593) | Windows renderer startup exceeded the 4-second warm maximum                         | Screenshot launches are serial. The first run measured 5793.1 ms for Chinese and 4381.3 ms for Japanese, while later launches were substantially faster. This alone does not establish a runner or application root cause. Preserve failures and complete timing evidence instead of raising thresholds or retrying until green. |

The screenshot matrix now writes its complete manifest, including startup
violations, before rejecting a performance failure. Previously that rejection
prevented the aggregate manifest from being saved, although individual a11y
files remained available. All performance thresholds remain unchanged.

## Verification discipline

- Run `npm run verify:ci` with Node 24 before publishing code changes.
  README-only pushes and pull requests skip CI; the main pre-push hook also
  skips these updates. README files are excluded from formatting checks.
- Use fixed examples for renderer feature tests. Do not read the actual README
  from CI tests or require its versions, badges, or copy to match code.
- Run native visual checks from a clean checkout of the candidate SHA.
  Local macOS results do not establish Windows or macOS x64 acceptance.
- Inspect the failing step and uploaded evidence before retrying. An external
  download failure and a failed application assertion require different fixes.
- Require every job for the final remote SHA to pass. Cancellation by a newer
  push is not a test failure; a historical failed SHA does not become repaired
  when a different SHA passes.

These changes address confirmed causes and improve diagnosis. They do not
promise that future regressions or hosted-runner/network failures cannot occur.
