import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { planAttachments } from "./attachments.ts";
import { rebuiltState } from "./projection.ts";
import { DETAILS_KEY, type FileRecord } from "./types.ts";

/** false: inject once per path, like opencode. true: re-inject changed files. */
const COMPARE_CONTENT = true;

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
		if (event.toolName !== "read" || event.isError) return undefined;
		const targetPath = event.input?.path;
		if (typeof targetPath !== "string" || targetPath === "") return undefined;
		if (!Array.isArray(event.content)) return undefined;

		const ctxAny = ctx as unknown as { sessionManager?: { buildSessionContext?: () => { messages: unknown } } };
		const built = ctxAny.sessionManager?.buildSessionContext?.();
		if (state === null) {
			state = rebuiltState((built?.messages ?? []) as never);
		}

		const plan = planAttachments({
			targetPath,
			root: ctx.cwd,
			known: state,
			compareContent: COMPARE_CONTENT,
		});
		if (plan.recorded.length === 0 && plan.attachments.length === 0) return undefined;

		for (const record of plan.recorded) state.set(record.path, record.sha);
		if (plan.attachments.length === 0) return undefined;

		return {
			content: [
				...event.content,
				...plan.attachments.map((file) => ({
					type: "text" as const,
					text: `Instructions from: ${file.path}\n${file.content}`,
				})),
			],
			details: mergeDetails(event.details, plan.attachments.map(({ path, sha }) => ({ path, sha }))),
			structuredContent: event.structuredContent,
		};
	});
}

export { planAttachments, rebuiltState, DETAILS_KEY };
