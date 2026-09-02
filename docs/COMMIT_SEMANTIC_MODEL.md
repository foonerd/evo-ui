# Commit Semantic Model

Status: active  
Purpose: keep history queryable as commit volume grows.

## 1) Required commit subject format

Use this exact subject pattern:

`<type>(<scope>): <result> — <why>`

Example:

`feat(playback): command correlation on transport actions — tie UI actions to gateway request ids`

## 2) Allowed types

- `feat`: new user-visible capability
- `fix`: bug or behavioral correction
- `refactor`: internal structure change without feature change
- `perf`: measurable runtime or resource improvement
- `test`: test-only additions/changes
- `docs`: documentation-only changes
- `chore`: maintenance work with no product/runtime impact
- `build`: packaging/build/toolchain changes
- `ci`: CI pipeline/workflow changes

## 3) Scopes for this repo

Prefer concrete feature or subsystem scopes:

- `ui-shell`
- `bootstrap`
- `playback`
- `queue`
- `browse`
- `system`
- `stream`
- `contracts`
- `docs`

If multiple areas are touched, choose the primary operational boundary.

## 4) Subject quality rules

- Start with the delivered result, not a generic verb (`add/update/work`).
- Keep subject line <= 100 chars where possible.
- Use present tense.
- Include an em dash (`—`) and why-clause for non-trivial changes.
- One logical delivery slice per commit.

## 5) Good vs bad examples

Good:

- `fix(queue): keep optimistic current_index coherent — avoid wrong selection after remove`
- `refactor(stream): extract event allowlist gate — lock unknown-event filtering contract`
- `test(contracts): cover command-action thrown execute path — ensure failure telemetry + finalize`

Bad:

- `update stuff`
- `changes`
- `fixes`
- `refactor(ui-shell): cleanup`
