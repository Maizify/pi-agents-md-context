import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bashReadTargets, segments } from "../src/bashReads.ts";

/** Paths only: most assertions are about which files a command reads. */
const paths = (command: string, options: { cwd: string }) =>
	bashReadTargets(command, options).map((target) => target.path);

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "pi-bash-reads-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

const tree = () =>
	workspace({
		"packages/foo/a.ts": "code",
		"packages/foo/b.ts": "code",
		"packages/bar/c.ts": "code",
		"packages/foo/AGENTS.md": "rules",
	});

test("segments splits on &&, ;, | but not inside quotes", () => {
	assert.deepEqual(segments("cd a && cat b; ls | grep c"), [["cd", "a"], ["cat", "b"], ["ls"], ["grep", "c"]]);
	assert.deepEqual(segments(`grep "a && b" f`), [["grep", "a && b", "f"]]);
});

test("cat of a relative file is a read target", () => {
	const cwd = tree();
	assert.deepEqual(paths("cat packages/foo/a.ts", { cwd }), [join(cwd, "packages/foo/a.ts")]);
});

test("cd moves the base directory for later segments", () => {
	const cwd = tree();
	assert.deepEqual(paths("cd packages/foo && sed -n 1,20p a.ts", { cwd }), [
		join(cwd, "packages/foo/a.ts"),
	]);
	assert.deepEqual(paths("cd packages/foo && cat b.ts", { cwd }), [join(cwd, "packages/foo/b.ts")]);
});

test("a bare cd, or cd with a non-reading command, yields nothing", () => {
	const cwd = tree();
	assert.deepEqual(paths("cd packages/foo", { cwd }), []);
	assert.deepEqual(paths("cd packages/foo && ls", { cwd }), []);
	assert.deepEqual(paths("cd packages/foo && grep -rn x .", { cwd }), []);
	assert.deepEqual(paths("cd packages/foo && pwd", { cwd }), []);
});

test("cd into a missing directory leaves the base unchanged, so the read is dropped", () => {
	const cwd = tree();
	assert.deepEqual(paths("cd nope && sed -n 1,5p a.ts", { cwd }), []);
});

test("search and listing commands never yield targets", () => {
	const cwd = tree();
	for (const command of ["grep -rn x packages", "ls packages/foo", "find packages -name '*.ts'", "git show HEAD"]) {
		assert.deepEqual(paths(command, { cwd }), [], command);
	}
});

test("sed -i is a write, not a read", () => {
	const cwd = tree();
	assert.deepEqual(paths("sed -i 's/a/b/' packages/foo/a.ts", { cwd }), []);
});

test("glob, variables and command substitution are skipped", () => {
	const cwd = tree();
	assert.deepEqual(paths("cat packages/foo/*.ts", { cwd }), []);
	assert.deepEqual(paths("cat $FILE", { cwd }), []);
	assert.deepEqual(paths("cat $(ls)", { cwd }), []);
});

test("redirect targets are not treated as read files", () => {
	const cwd = tree();
	assert.deepEqual(paths("cat packages/foo/a.ts > out.txt", { cwd }), [join(cwd, "packages/foo/a.ts")]);
	assert.deepEqual(paths("sed -n 1,5p packages/foo/a.ts >> log.txt", { cwd }), [
		join(cwd, "packages/foo/a.ts"),
	]);
});

test("several reads in one command keep their order, deduplicated", () => {
	const cwd = tree();
	assert.deepEqual(paths("cat packages/foo/a.ts && cat packages/bar/c.ts", { cwd }), [
		join(cwd, "packages/foo/a.ts"),
		join(cwd, "packages/bar/c.ts"),
	]);
	assert.deepEqual(paths("cat packages/foo/a.ts; head -3 packages/foo/a.ts", { cwd }), [
		join(cwd, "packages/foo/a.ts"),
	]);
});

test("prefix words such as sudo do not hide the reader", () => {
	const cwd = tree();
	assert.deepEqual(paths("sudo cat packages/foo/a.ts", { cwd }), [join(cwd, "packages/foo/a.ts")]);
	assert.deepEqual(paths("FOO=1 cat packages/foo/a.ts", { cwd }) , [join(cwd, "packages/foo/a.ts")]);
});

test("head and tail count as reads", () => {
	const cwd = tree();
	assert.deepEqual(paths("head -100 packages/foo/AGENTS.md", { cwd }), [join(cwd, "packages/foo/AGENTS.md")]);
	assert.deepEqual(paths("tail -n 20 packages/foo/a.ts", { cwd }), [join(cwd, "packages/foo/a.ts")]);
});

test("paths outside the workspace are still returned; the caller bounds them", () => {
	const cwd = tree();
	assert.deepEqual(paths("cat /etc/hosts", { cwd }), ["/etc/hosts"]);
});

test("whole-file reads are complete, slices are not", () => {
	const cwd = workspace({ "a.ts": "x", "b.ts": "y" });

	assert.deepEqual(bashReadTargets("cat a.ts", { cwd }), [{ path: join(cwd, "a.ts"), complete: true }]);
	assert.deepEqual(bashReadTargets("cat a.ts b.ts", { cwd }).map((t) => t.complete), [true, true]);
	assert.equal(bashReadTargets("head -20 a.ts", { cwd })[0].complete, false);
	assert.equal(bashReadTargets("tail -20 a.ts", { cwd })[0].complete, false);
	assert.equal(bashReadTargets("sed -n 1,20p a.ts", { cwd })[0].complete, false);
	assert.equal(bashReadTargets("awk '{print}' a.ts", { cwd })[0].complete, false);
});

test("a pipe into head makes the earlier cat partial", () => {
	const cwd = workspace({ "a.ts": "x" });

	assert.equal(bashReadTargets("cat a.ts | head -100", { cwd })[0].complete, false);
	assert.equal(bashReadTargets("head -100 a.ts", { cwd })[0].complete, false);
	// A slice and a whole read of the same file: the whole one wins.
	assert.deepEqual(bashReadTargets("head -3 a.ts; cat a.ts", { cwd }), [
		{ path: join(cwd, "a.ts"), complete: true },
	]);
	// Separate files keep their own answer.
	assert.deepEqual(bashReadTargets("cat a.ts; head -3 a.ts", { cwd }).map((t) => t.complete), [false]);
});
