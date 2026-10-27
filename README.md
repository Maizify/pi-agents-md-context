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

- Successful `read`, `edit`, and `write` results trigger it: a file's content, or a change to it, is in the transcript.
- So do `bash` commands that read a file's content: `cat`, `sed` (not `-i`), `head`, `tail`, `bat`, `less`, `awk`. Pi agents reach for these as often as `read`, so they count as the same channel.
- `cd` only moves the directory used to resolve later paths; it never loads anything by itself. `ls`, `grep`, `find` and other exploration commands never trigger.
- At most two context files are appended per tool result, so one `cat a b c` cannot flood the context.
- Targets outside the working directory are ignored; the ancestor chain above it is Pi's job.
- Content is hashed. Unchanged files stay quiet; changed files are injected again.
- Reading or writing a context file itself is recorded, not appended back.
- Injection lands in the tool result, not the system prompt, as one extra text block after the tool output: Pi's own `Project-specific instructions and guidelines:` preamble plus a `<project_instructions path="…">` wrapper, so the model reads it the same way it reads the context files Pi already loaded — and can see it is not part of the file the tool just returned.
- Being a tool result, it can still be compacted away; rules that must survive belong in a root `AGENTS.md` or `.pi/APPEND_SYSTEM.md`.
- Search-only work (`grep`, `rg`, `ls`, `find`) loads nothing; the context arrives at the first file read, whether through `read` or `cat`/`sed`.
- Writes through the shell (`sed -i`, `tee`, output redirection) are not detected either; `edit` and `write` are.

## Source layout

```
src/projection.ts   rebuiltState(messages)   pure: visible records -> known map
src/attachments.ts  planAttachments(input)   pure: one file -> what to append
src/bashReads.ts    bashReadTargets(cmd, cwd) pure: shell command -> files it reads
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
