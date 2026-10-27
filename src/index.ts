import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { planAttachments, type Attachment } from "./attachments.ts";
import { bashReadTargets } from "./bashReads.ts";
import { rebuiltState } from "./projection.ts";
import { DETAILS_KEY, type FileRecord } from "./types.ts";

/** false: inject once per path, like opencode. true: re-inject changed files. */
const COMPARE_CONTENT = true;

/** Cap per tool result so one `cat a b c` cannot flood the context. */
const MAX_INJECTIONS_PER_RESULT = 2;

/**
 * `read` is explicit. Pi agents reach for `cat` / `sed -n` / `head` just as
 * often, so those count as the same channel — but only when they really read a
 * file (`cd`, `ls`, `grep`, `find` never do).
 */
function targetsFor(event: { toolName: string; input: Record<string, unknown> }, cwd: string): string[] {
	if (event.toolName === "bash") {
		const command = event.input?.command;
		return typeof command === "string" ? bashReadTargets(command, { cwd }) : [];
	}
	const path = event.input?.path;
	return typeof path === "string" && path !== "" ? [path] : [];
}

/** Pi's own preamble for project context, reused so the block reads as instructions. */
const PROJECT_CONTEXT_PREAMBLE = "Project-specific instructions and guidelines:";

/** Same shape Pi uses for context files in the system prompt. */
function formatContextBlock(file: Attachment): string {
	return `<project_instructions path="${file.path}">\n${file.content.trimEnd()}\n</project_instructions>`;
}

function mergeDetails(base: unknown, files: FileRecord[]): Record<string, unknown> {
	const payload = { files };
	if (base && typeof base === "object" && !Array.isArray(base)) {
		return { ...(base as Record<string, unknown>), [DETAILS_KEY]: payload };
	}
	return base === undefined ? { [DETAILS_KEY]: payload } : { readDetails: base, [DETAILS_KEY]: payload };
}

export default function agentsMdContext(pi: ExtensionAPI): void {
	// Rebuilt lazily from the visible projection: compaction drops records with it.
	let state: Map<string, string> | null = null;

	const invalidate = () => {
		state = null;
	};

	pi.on("session_start", invalidate);
	pi.on("session_compact", invalidate);

	pi.on("tool_result", (event, ctx: ExtensionContext) => {
		if (event.isError || !Array.isArray(event.content)) return undefined;

		const triggers = event.toolName === "bash" || event.toolName === "read" ||
			event.toolName === "edit" || event.toolName === "write";
		if (!triggers) return undefined;

		const targets = targetsFor(event, ctx.cwd);
		if (targets.length === 0) return undefined;

		if (state === null) {
			const manager = (ctx as unknown as { sessionManager?: { buildSessionContext?: () => { messages: unknown } } })
				.sessionManager;
			state = rebuiltState((manager?.buildSessionContext?.().messages ?? []) as never);
		}
		const known = state;

		const attachments: Attachment[] = [];
		let injected = 0;

		for (const target of targets) {
			const plan = planAttachments({
				targetPath: target,
				root: ctx.cwd,
				known,
				compareContent: COMPARE_CONTENT,
			});
			if (plan.recorded.length === 0) continue;

			const pendingInjections = new Set(plan.attachments.map((file) => file.path));

			// A read of a context file itself, or anything already injected, is recorded only.
			for (const record of plan.recorded) {
				if (pendingInjections.has(record.path)) continue;
				known.set(record.path, record.sha);
			}

			for (const file of plan.attachments) {
				if (injected >= MAX_INJECTIONS_PER_RESULT) break; // left unrecorded: next command may load it
				injected++;
				known.set(file.path, file.sha);
				attachments.push(file);
			}
		}

		if (attachments.length === 0) return undefined;

		return {
			content: [
				...event.content,
				{
					// One block, separated from the tool output by Pi's own preamble: this is
					// context loaded from another file, not part of what the tool returned.
					type: "text" as const,
					text: [PROJECT_CONTEXT_PREAMBLE, ...attachments.map(formatContextBlock)].join("\n\n"),
				},
			],
			details: mergeDetails(event.details, attachments.map(({ path, sha }) => ({ path, sha }))),
			structuredContent: event.structuredContent,
		};
	});
}

export { planAttachments, rebuiltState, bashReadTargets, DETAILS_KEY };
