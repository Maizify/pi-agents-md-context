import { DETAILS_KEY, type FileRecord } from "./types.ts";

/** The only fields this module reads off a projected message. */
export type ProjectedMessage = { role?: string; details?: unknown };

function recordsIn(details: unknown): FileRecord[] {
	if (!details || typeof details !== "object" || Array.isArray(details)) return [];
	const payload = (details as Record<string, unknown>)[DETAILS_KEY];
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
	const files = (payload as { files?: unknown }).files;
	if (!Array.isArray(files)) return [];

	const out: FileRecord[] = [];
	for (const record of files) {
		if (!record || typeof record !== "object" || Array.isArray(record)) continue;
		const { path, sha } = record as { path?: unknown; sha?: unknown };
		if (typeof path !== "string" || typeof sha !== "string") continue;
		out.push({ path, sha });
	}
	return out;
}

/**
 * Rebuild "what the model can still see" from the compaction-aware projection.
 *
 * Compaction drops messages; their records disappear here with them, so a file
 * whose injection was summarized away loads again on the next read. A session
 * restart rebuilds from the same projection, so nothing already visible is
 * injected twice.
 */
export function rebuiltState(messages: Iterable<ProjectedMessage>): Map<string, string> {
	const state = new Map<string, string>();
	for (const message of messages) {
		if (!message || message.role !== "toolResult") continue;
		for (const record of recordsIn(message.details)) state.set(record.path, record.sha);
	}
	return state;
}
