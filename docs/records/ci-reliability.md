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

| Runs                                                                                                                                                             | Evidence                                                                            | Treatment                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [35453149862](https://github.com/EurekaRaider/Artemis/actions/runs/35453149862), [35512822294](https://github.com/EurekaRaider/Artemis/actions/runs/35512822294) | CSS/source expectations and accessibility evidence no longer matched the changed UI | These checks catch changes in UI contracts. Update intended behavior and its evidence together; do not globally disable the contracts. Later main commits already repaired these failures.                                                                                                                                                                                                                    |
| [35478491374](https://github.com/EurekaRaider/Artemis/actions/runs/35478491374), [35486744244](https://github.com/EurekaRaider/Artemis/actions/runs/35486744244) | Concurrent Goal smoke renderers exceeded their startup deadline                     | The existing main fix increased the initialization deadline within the aggregate workload budget. It is already present in this repair's base.                                                                                                                                                                                                                                                                |
| [35491224206](https://github.com/EurekaRaider/Artemis/actions/runs/35491224206), [35503223593](https://github.com/EurekaRaider/Artemis/actions/runs/35503223593) | Windows renderer startup exceeded the 4-second warm maximum                         | Screenshot launches are serial. The first run measured 5793.1 ms for Chinese and 4381.3 ms for Japanese, while later launches were substantially faster. The later repair run reproduced first-use CJK delays. The harness gave every variant a fresh profile but classified all except the first English launch as warm. Measure a cold/warm pair for each variant instead of classifying by array position. |

The screenshot matrix now writes its complete manifest, including startup
violations, before rejecting a performance failure. Previously that rejection
prevented the aggregate manifest from being saved, although individual a11y
files remained available. All performance thresholds remain unchanged.

The repair's first remote run, [35557046786](https://github.com/EurekaRaider/Artemis/actions/runs/35557046786),
also exposed a Windows shell permission test with a 30-second launcher budget.
It returned empty output after 53.1 seconds including the preceding native file
snapshot. Native helper compilation takes about 23 seconds per request on
these runners, leaving little room for shell initialization. The functional
test now allows 60 seconds for the launcher within a 180-second test deadline,
and explicitly checks cancellation and exit status before checking output.
The file-grant, protected-data and writeback assertions remain intact. Product
shell timeouts and startup performance thresholds are unchanged; Windows-native
CI is required to validate this test adjustment.

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

## Cold and warm startup measurements

[35557936054](https://github.com/EurekaRaider/Artemis/actions/runs/35557936054)
reproduced Windows startup failures: Traditional Chinese took 4582.7 ms and
Japanese 5304.8 ms; subsequent scaled Japanese took 918.7 ms. The previous
harness created a new user profile for every variant while classifying only
the first English launch as cold. Different fresh profiles and first-use locale
resources were therefore compared against a warm-start ceiling.

Manifest version 4 records two fixed launches per variant: a fresh-profile
cold sample and a warm sample reusing the same profile. Both launches run the
visual, accessibility and runtime-security assertions and retain their evidence.
All 27 cold samples must satisfy the existing 10-second ceiling; all 27 warm
samples (including English) must satisfy the existing 4-second ceiling and
warm-outlier limit. There are no retries or discarded timing samples. The
aggregate screenshot workload budget remains 180 seconds. Missing, mismatched,
slow-cold and slow-warm sample fixtures verify that the gate still fails closed.

Renderer stage marks and navigation timing are retained in both samples to
distinguish module loading, skin initialization, state retrieval and the first
ready render. The 10-second cold ceiling is a failure guard, not a product
latency target; passing it alone does not establish acceptable startup UX.

## Runtime provisioning outside performance measurement

In [35558702205](https://github.com/EurekaRaider/Artemis/actions/runs/35558702205),
macOS x64 exhausted the screenshot workload deadline after completing only part
of the matrix. Its output included `Downloading Electron binary...`. Electron
43.2.0 no longer has a package postinstall; its `index.js` invokes `install.js`
on the first `require("electron")` when the executable is absent. Thus `npm ci`
does not guarantee a provisioned binary, and the first visual workload also
paid the download/extraction cost. The orchestrator now prepares the runtime
in a separate, bounded five-minute phase and records that duration separately.
Screenshot and per-launch performance limits remain unchanged.
