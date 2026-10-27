import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import agentsMdContext, { DETAILS_KEY } from "../src/index.ts";

type Handler = (event: any, ctx: any) => any;

function harness() {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	};
	agentsMdContext(pi as never);

	const fire = async (event: string, payload: unknown, ctx: unknown) => {
		let result: any;
		for (const handler of handlers.get(event) ?? []) {
			const out = await handler(payload, ctx);
			if (out !== undefined) result = out;
		}
		return result;
	};

	return { fire };
}

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "pi-agents-md-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

function context(cwd: string, messages: unknown[] = []) {
	return {
		cwd,
		sessionManager: { buildSessionContext: () => ({ messages }) },
	};
}

const toolResult = (toolName: string, path: string) => ({
	type: "tool_result",
	toolName,
	input: { path },
	content: [{ type: "text", text: "tool output" }],
	isError: false,
});

test("read inside a subdirectory appends the context file", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();

	const result = await fire("tool_result", toolResult("read", "packages/foo/a.ts"), context(cwd));

	assert.ok(result);
	assert.match(result.content.at(-1).text, /Instructions from: .*packages\/foo\/AGENTS\.md\nfoo rules/);
	assert.equal(result.details[DETAILS_KEY].files.length, 1);
});

test("a second read of the same directory stays silent", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();
	const ctx = context(cwd);

	await fire("tool_result", toolResult("read", "packages/foo/a.ts"), ctx);
	const second = await fire("tool_result", toolResult("read", "packages/foo/a.ts"), ctx);

	assert.equal(second, undefined);
});

test("edit inside a subdirectory appends the context file", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();

	const result = await fire("tool_result", toolResult("edit", "packages/foo/a.ts"), context(cwd));

	assert.ok(result);
	assert.match(result.content.at(-1).text, /foo rules/);
});

test("write inside a new subdirectory appends the context file", async () => {
	const cwd = workspace({ "packages/bar/AGENTS.md": "bar rules", "packages/bar/keep.txt": "x" });
	const { fire } = harness();

	const result = await fire("tool_result", toolResult("write", "packages/bar/new.ts"), context(cwd));

	assert.ok(result);
	assert.match(result.content.at(-1).text, /bar rules/);
});

test("bash, ls and grep never trigger", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();

	for (const tool of ["bash", "ls", "grep", "find"]) {
		const result = await fire("tool_result", toolResult(tool, "packages/foo"), context(cwd));
		assert.equal(result, undefined, `${tool} must not trigger`);
	}
});

test("targets outside the working directory are ignored", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules" });
	const { fire } = harness();

	const result = await fire("tool_result", toolResult("read", "/etc/hosts"), context(cwd));

	assert.equal(result, undefined);
});

test("reading a context file itself records it without appending it back", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();
	const ctx = context(cwd);

	const read = await fire("tool_result", toolResult("read", "packages/foo/AGENTS.md"), ctx);
	assert.equal(read, undefined);

	const next = await fire("tool_result", toolResult("read", "packages/foo/a.ts"), ctx);
	assert.equal(next, undefined);
});

test("records are rebuilt from the visible projection after a session restart", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const first = harness();

	const result = await first.fire("tool_result", toolResult("read", "packages/foo/a.ts"), context(cwd));
	const persisted = { role: "toolResult", details: result.details };

	const restarted = harness();
	const afterRestart = await restarted.fire(
		"tool_result",
		toolResult("read", "packages/foo/a.ts"),
		context(cwd, [persisted]),
	);

	assert.equal(afterRestart, undefined);
});

test("compaction drops the record, so the file loads again", async () => {
	const cwd = workspace({ "packages/foo/AGENTS.md": "foo rules", "packages/foo/a.ts": "code" });
	const { fire } = harness();
	const ctx = context(cwd);

	await fire("tool_result", toolResult("read", "packages/foo/a.ts"), ctx);
	await fire("session_compact", { type: "session_compact" }, ctx);
	const reloaded = await fire("tool_result", toolResult("read", "packages/foo/a.ts"), ctx);

	assert.ok(reloaded);
	assert.match(reloaded.content.at(-1).text, /foo rules/);
});
