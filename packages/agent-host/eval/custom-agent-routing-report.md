# Custom sub-agent automatic-delegation evaluation

D#152 PR5. Fixed synthetic task set (`eval/custom-agent-routing-cases.ts`)
run through the real `spawn_agent` tool entry; decisions are read from the
durable `custom-agent.route` audit each spawn produces. Regenerate with:

```
ARTEMIS_EVAL_UPDATE=1 npx vitest run test/custom-agent-routing-eval.test.ts
```

## Metrics (deterministic layer)

| Metric | Value |
| --- | --- |
| Cases | 15 |
| Correct-selection rate (should-pick) | 100.0% |
| False-positive rate (no-delegation) | 0.0% |
| Miss rate (should-pick) | 0.0% |
| Ambiguity preserved | 100.0% |
| Duplicate work (auto-accepted instances) | 0 |
| Task success rate (labeled outcome achieved) | 100.0% |
| Model tokens | 0 (lexical layer makes no model calls) |
| Cost | 0 |
| Wall-clock | recorded in console output, not in this report |

## Gates (all must pass)

| Gate | Result |
| --- | --- |
| P1 reference-required corrections fired with the right candidate | PASS |
| No automatic acceptance (duplicate work = 0) | PASS |
| Explicit id is never overridden by trigger words | PASS |
| Every labeled outcome achieved (100% deterministic gate) | PASS |

## Per-case outcomes

| Case | Label | Decision | Candidates | Instances | Expected met |
| --- | --- | --- | --- | --- | --- |
| C01 | should-not-delegate | free-role | — | 1 | yes |
| C02 | no-match | free-role | — | 1 | yes |
| C03 | should-pick | advisory | eval-security | 1 | yes |
| C04 | should-pick | advisory | eval-security | 1 | yes |
| C05 | ambiguous | advisory | eval-security, eval-compliance | 1 | yes |
| C06 | ambiguous | advisory | eval-security, eval-compliance | 1 | yes |
| C07 | boundary-safety | free-role | — | 1 | yes |
| C08 | normalization | advisory | eval-reviewer | 1 | yes |
| C09 | normalization | reference-required | eval-reviewer | 0 | yes |
| C10 | manual-only-control | free-role | — | 1 | yes |
| C11 | manual-only-control | free-role | — | 1 | yes |
| C12 | should-not-delegate | free-role | — | 1 | yes |
| C13 | should-pick | advisory | eval-docs | 1 | yes |
| C14 | should-pick | advisory | eval-docs | 1 | yes |
| C15 | explicit-override | accepted | — | 1 | yes |

## Baseline (automatic routing off)

With the automatic catalog empty every case degenerates to a free role:
correct-selection 0.0%, miss rate 100.0% on should-pick, false-positive
0.0%, duplicate work 0. This baseline is derived analytically and pinned
by the empty-catalog control in `test/custom-agent-routing.test.ts`.

## Probabilistic (model-semantic) comparison

The P2 semantic choice is model behavior and is not promised to match
100%. Procedure for a live-model run: pin provider/model/thinking in the
desktop settings, run each should-pick and ambiguous task as a real turn,
and read `custom-agent.route` audits for selected vs candidate ids.
Compare correct-selection/false-positive/miss against the baseline above
under the fixed configuration; record tokens and cost from turn usage.
This report intentionally ships without live-model numbers.

