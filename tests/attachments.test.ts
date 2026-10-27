import assert from "node:assert/strict";
import { test } from "node:test";

import { dirsBetween, hashContent, planAttachments } from "../src/attachments.ts";

const ROOT = "/repo";

function fsStub(files: Record<string, string>) {
	const paths = new Set(Object.keys(files));
	return {
		isFile: (path: string) => paths.has(path),
		readFile: (path: string) => {
			const content = files[path];
			if (content === undefined) throw new Error(`ENOENT ${path}`);
			return content;
		},
	};
}

test("dirsBetween walks from the file's directory up to the root, root-most first", () => {
	assert.deepEqual(dirsBetween("/repo/packages/magi/src/a.ts", ROOT), [
		"/repo/packages",
		"/repo/packages/magi",
		"/repo/packages/magi/src",
	]);
});

test("dirsBetween refuses paths outside the root", () => {
	assert.deepEqual(dirsBetween("/elsewhere/a.ts", ROOT), []);
	assert.deepEqual(dirsBetween("/repo/../other/a.ts", ROOT), []);
});

test("dirsBetween returns nothing for a file sitting in the root itself", () => {
	assert.deepEqual(dirsBetween("/repo/a.ts", ROOT), []);
});

test("planAttachments injects every nested context file, root-most first", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "packages rules",
		"/repo/packages/magi/AGENTS.md": "magi rules",
		"/repo/packages/magi/src/a.ts": "code",
	});

	const plan = planAttachments({ targetPath: "packages/magi/src/a.ts", root: ROOT, known: new Map(), ...fs });

	assert.deepEqual(
		plan.attachments.map((file) => file.path),
		["/repo/packages/AGENTS.md", "/repo/packages/magi/AGENTS.md"],
	);
	assert.deepEqual(plan.attachments.map((file) => file.content), ["packages rules", "magi rules"]);
});

test("planAttachments skips files the visible projection already carries", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "packages rules",
		"/repo/packages/magi/AGENTS.md": "magi rules",
		"/repo/packages/magi/src/a.ts": "code",
	});
	const known = new Map([["/repo/packages/magi/AGENTS.md", hashContent("magi rules")]]);

	const plan = planAttachments({ targetPath: "packages/magi/src/a.ts", root: ROOT, known, ...fs });

	assert.deepEqual(plan.attachments.map((file) => file.path), ["/repo/packages/AGENTS.md"]);
});

test("planAttachments re-injects a file whose content changed", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "new rules",
		"/repo/packages/a.ts": "code",
	});
	const known = new Map([["/repo/packages/AGENTS.md", hashContent("old rules")]]);

	const plan = planAttachments({ targetPath: "packages/a.ts", root: ROOT, known, ...fs });

	assert.equal(plan.attachments.length, 1);
	assert.equal(plan.attachments[0].content, "new rules");
});

test("planAttachments stays silent on an unchanged file when comparison is on", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "same rules",
		"/repo/packages/a.ts": "code",
	});
	const known = new Map([["/repo/packages/AGENTS.md", hashContent("same rules")]]);

	const plan = planAttachments({ targetPath: "packages/a.ts", root: ROOT, known, ...fs });

	assert.deepEqual(plan.attachments, []);
});

test("compareContent: false dedupes by path only", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "same rules",
		"/repo/packages/a.ts": "code",
	});
	const known = new Map([["/repo/packages/AGENTS.md", "stale-hash"]]);

	const plan = planAttachments({
		targetPath: "packages/a.ts",
		root: ROOT,
		known,
		compareContent: false,
		...fs,
	});

	assert.deepEqual(plan.attachments, []);
});

test("reading a context file itself records it without injecting it again", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "packages rules",
		"/repo/packages/magi/AGENTS.md": "magi rules",
	});

	const plan = planAttachments({ targetPath: "packages/magi/AGENTS.md", root: ROOT, known: new Map(), ...fs });

	// the file that was just read is not appended back; the parent rules still are
	assert.deepEqual(plan.attachments.map((file) => file.path), ["/repo/packages/AGENTS.md"]);
	assert.deepEqual(
		plan.recorded.map((record) => record.path),
		["/repo/packages/AGENTS.md", "/repo/packages/magi/AGENTS.md"],
	);
});

test("AGENTS.override.md wins over AGENTS.md in the same directory", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.override.md": "override rules",
		"/repo/packages/AGENTS.md": "plain rules",
		"/repo/packages/a.ts": "code",
	});

	const plan = planAttachments({ targetPath: "packages/a.ts", root: ROOT, known: new Map(), ...fs });

	assert.deepEqual(plan.attachments.map((file) => file.path), ["/repo/packages/AGENTS.override.md"]);
});

test("unreadable files are skipped without breaking the plan", () => {
	const fs = {
		isFile: (path: string) => path === "/repo/packages/AGENTS.md" || path === "/repo/packages/a.ts",
		readFile: () => {
			throw new Error("EACCES");
		},
	};

	const plan = planAttachments({ targetPath: "packages/a.ts", root: ROOT, known: new Map(), ...fs });

	assert.deepEqual(plan.attachments, []);
	assert.deepEqual(plan.recorded, []);
});

test("absolute target paths work the same as relative ones", () => {
	const fs = fsStub({
		"/repo/packages/AGENTS.md": "packages rules",
		"/repo/packages/a.ts": "code",
	});

	const plan = planAttachments({ targetPath: "/repo/packages/a.ts", root: ROOT, known: new Map(), ...fs });

	assert.equal(plan.attachments.length, 1);
});
