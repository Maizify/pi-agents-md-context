import assert from "node:assert/strict";
import { test } from "node:test";

import { rebuiltState } from "../src/projection.ts";
import { DETAILS_KEY } from "../src/types.ts";

const toolResult = (files: { path: string; sha: string }[], extra: Record<string, unknown> = {}) => ({
	role: "toolResult",
	details: { ...extra, [DETAILS_KEY]: { files } },
});

test("rebuiltState collects records carried by visible tool results", () => {
	const state = rebuiltState([
		{ role: "user", details: undefined },
		toolResult([{ path: "/repo/a/AGENTS.md", sha: "s1" }]),
		toolResult([{ path: "/repo/b/AGENTS.md", sha: "s2" }]),
	]);

	assert.deepEqual([...state], [
		["/repo/a/AGENTS.md", "s1"],
		["/repo/b/AGENTS.md", "s2"],
	]);
});

test("rebuiltState ignores assistant messages and foreign details", () => {
	const state = rebuiltState([
		{ role: "assistant", details: { [DETAILS_KEY]: { files: [{ path: "/x", sha: "y" }] } } },
		{ role: "toolResult", details: { unrelated: true } },
		{ role: "toolResult", details: { [DETAILS_KEY]: { files: "nope" } } },
		{ role: "toolResult", details: { [DETAILS_KEY]: { files: [null, 3, { path: 1 }] } } },
	]);

	assert.equal(state.size, 0);
});

test("rebuiltState keeps the read tool's own details intact", () => {
	const state = rebuiltState([
		toolResult([{ path: "/repo/a/AGENTS.md", sha: "s1" }], { preview: "code", truncated: false }),
	]);

	assert.equal(state.get("/repo/a/AGENTS.md"), "s1");
});

test("a message removed by compaction no longer contributes a record", () => {
	const kept = toolResult([{ path: "/repo/b/AGENTS.md", sha: "s2" }]);
	const summarizedAway = toolResult([{ path: "/repo/a/AGENTS.md", sha: "s1" }]);

	const before = rebuiltState([summarizedAway, kept]);
	assert.equal(before.has("/repo/a/AGENTS.md"), true);

	const after = rebuiltState([kept]);
	assert.equal(after.has("/repo/a/AGENTS.md"), false);
	assert.equal(after.has("/repo/b/AGENTS.md"), true);
});

test("later records win over earlier ones for the same path", () => {
	const state = rebuiltState([
		toolResult([{ path: "/repo/a/AGENTS.md", sha: "old" }]),
		toolResult([{ path: "/repo/a/AGENTS.md", sha: "new" }]),
	]);

	assert.equal(state.get("/repo/a/AGENTS.md"), "new");
});
