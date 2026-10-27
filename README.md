# pi-agents-md-context

English | [简体中文](README.zh-CN.md)

[![CI](https://github.com/Maizify/pi-agents-md-context/actions/workflows/ci.yml/badge.svg)](https://github.com/Maizify/pi-agents-md-context/actions/workflows/ci.yml)

Nested `AGENTS.md` context for [Pi](https://github.com/earendil-works/pi), deduped through the **visible** session projection.

Pi loads context files from the working directory and its ancestors. Files in subdirectories are not loaded. This extension appends them when the agent reads a file under them.

## Install

```bash
pi install npm:pi-agents-md-context   # global, once published
pi install ./path/to/pi-agents-md-context
pi -e ./path/to/pi-agents-md-context  # try once, no settings change
```

## What it does

Reading `packages/web/src/server.ts` appends every context file between that directory and the working directory, root-most first:

```
packages/AGENTS.md
packages/web/AGENTS.md
packages/web/src/AGENTS.md   (if present)
```

Filename precedence matches Pi: `AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md`, one file per directory.

## Why another one

Most nested-context loaders keep their dedupe state in a process-local cache. That causes two problems: resuming a session after a restart injects the same text again (and again), and nothing reloads after compaction drops the message that carried it.

This extension stores what it injected in the read result's `details`, which is persisted with the message, and rebuilds its state from `sessionManager.buildSessionContext()` — the compaction-aware projection sent to the model.

| Situation | Process-local cache | This extension |
|---|---|---|
| Restart + resume session | injects again (duplicates) | no duplicate |
| Compaction dropped the read result | never reloads (lost) | reloads on next read |
| `AGENTS.md` edited on disk | new session only | re-injected when content changed |
| Same file read twice in a row | no duplicate | no duplicate |

## Behaviour details

- Only successful `read` results trigger it. `ls`, `grep`, `glob`, and shell commands do not.
- Targets outside the working directory are ignored; the ancestor chain above it is Pi's job.
- Content is hashed. Unchanged files stay quiet; changed files are injected again.
- A read of a context file itself is recorded, not appended back.
- Injection lands in the tool result, not the system prompt. Rules that must survive compaction belong in a root `AGENTS.md` or `.pi/APPEND_SYSTEM.md`.

## Source layout

```
src/projection.ts   rebuiltState(messages)   pure: visible records -> known map
src/attachments.ts  planAttachments(input)   pure: one read -> what to append
src/index.ts        extension wiring (session_start / session_compact / tool_result)
```

Both pure functions are covered by `node --test`; no Pi process is started.

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
