<div align="center">

# 🛡 Skill Gate System

**Deterministic skill enforcement for OMP agents**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v5.3.2-green.svg)](src/skill-gate.ts)
[![Runtime](https://img.shields.io/badge/runtime-Bun%20%7C%20OMP%20extension-orange.svg)](https://github.com/can1357/oh-my-pi)

[Русская версия](README.md) · [Docs](docs/) · [Spec](specs/)

</div>

---

> **The problem:** an agent opens a skill, then works right past it. Or never opens one at all.
> **Prompts don't fix it:** a written rule costs the model nothing to violate.
> **The fix:** two layers - one deterministic, one a cheap reviewer model.

## What it looks like live

```text
┌─ Layer 1 ──────────────────────────────────────────────┐
│ agent: touches code, no skill opened                    │
│ gate:  ✋ BLOCKED — read skill://<name> first            │
│         or a "skills: X — take X" declaration line      │
│         or "no applicable skills - reason"              │
├─ Layer 2 ──────────────────────────────────────────────┤
│ agent: skill opened, checklist extracted (o1..o6)       │
│ gate:  before finishing — a status line for each item   │
│         "done: [o4] — evidence: <fact from the turn>"   │
│ gate:  evidence matched against the run journal? ✅      │
│         invented or self-confirming? ✋ BLOCKED          │
└─────────────────────────────────────────────────────────┘
```

## Two layers, two jobs

| Layer | Who | What it holds | How it acts |
|:---|:---|:---|:---|
| **Gate** | extension code, no model | form: skill opened, status per item, evidence tied to a real event of the turn | blocks the tool call |
| **Advisor** | cheap reviewer model | substance: the artifact contains what the skill item demands | post-turn remark, never blocks |

Skill choice stays with the agent: the gate holds the form, the Advisor holds the meaning.

## Bench results

20 prompts × 18 domains + 2 control, three passes. Details: [`bench/`](bench/).

| Metric | Pass 1 | Pass 2 | Pass 3 |
|:---|:---|:---|:---|
| Skill choice | 20/20 correct | 20/20 | 8/8 rerun |
| Gate blocks per run | ~2.5 | ~2 | 0-1 |
| Turns per run (avg) | 27 | 25 | **13** |
| Advisor remarks | 30 (24 noise) | 24 | **5** |
| Statuses accepted | on 3rd-4th try | on 2nd-3rd | **first try** |

## Quick start

Requires OMP with extension support and Bun for the probes.

```bash
# 1. drop the extension into your profile
cp src/skill-gate.ts ~/.omp/profiles/<your-profile>/agent/extensions/

# 2. background skills of the profile (always loaded - not a choice)
echo '["skill-name"]' > ~/.omp/profiles/<your-profile>/agent/extensions/skill-gate.background.json

# 3. probes (bun, no network, no model)
bun probes/obligations-test.ts   # 13/13
bun probes/quote-test.ts         # 3/3
bun probes/rx-fix-test.ts        # 9/9

# 4. see which of your skills carry obligations
bun probes/mass-check.ts ~/.omp/profiles/<your-profile>/agent/skills
```

New OMP sessions pick the extension up at start. Cases that need locally installed skills print "skipped" and don't fail on a foreign machine.

## Repository layout

```
src/skill-gate.ts            the gate extension (v5.3.2)
advisor/WATCHDOG.md          Advisor instructions: role, boundaries, limits
advisor/WATCHDOG.yml         OMP wiring (--advisor)
specs/                       requirements.md · design.md · tasks.md
probes/                      probes: obligations, quote, rx-fix, ref, bg-skill-gap
bench/                       20-prompt bench, three-pass summaries
docs/                        gate.md · advisor.md · bench.md · history.md · reproduce.md
history/README-v1.md         first public release (v1.0)
```

## Version history

| Version | Essence |
|:---|:---|
| v0.1 | proof of concept: env-flag blocking of heavy tools |
| v1.0 | public release: full layer 1, "no skills" declaration, post-turn summary |
| v3.2 | stable layer 1 across three profiles; published here separately |
| v5.0/v5.1 | layer 2: obligations from SKILL.md, statuses, evidence checks |
| v5.2 | bench-driven fixes: TOTAL_CAP=10, quotes from tool outputs only, self-confirmation banned |
| v5.3 | background skills no longer wash the turn: list in `skill-gate.background.json` |
| v5.3.1 | single R5 invariant: both quote forms searched only in tool outputs |
| v5.3.2 | skill-choice line "skills: X — take X" is a legal declaration: background-only washes, a profile claim awaits read |

Full history: `git log`. Spec with requirements and gates: [`specs/`](specs/).

## Limits

- The gate checks form, not substance: "done: o4, evidence: README.md" passes even with a bad README. Substance is the Advisor's job, and it is probabilistic.
- The obligation report costs one or two turns per task.
- Expensive tasks are expensive on their own, not because of the gate: they need their own iteration cap.
- Subagents (`task`) are not covered: the gate watches the main agent only.

## On checksums

Git on Windows converts line endings at checkout (CRLF), so the file's md5 in a clone differs. For a byte-exact comparison: `git show HEAD:src/skill-gate.ts | md5sum`.

## Contributing

The project is in active testing. It has been run on three profiles and the 20-prompt bench, but foreign scenarios and foreign skill catalogs are the real feedback value. Remarks, questions and [issues](https://github.com/ai4bordon/omp-skill-gate/issues) are welcome.

## License

MIT - see [LICENSE](LICENSE).

[Русская версия](README.md)
