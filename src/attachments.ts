import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { CONTEXT_FILENAMES, type FileRecord } from "./types.ts";

/** One file that should join the read result. */
export type Attachment = FileRecord & { content: string };

export type PlanInput = {
	/** Path handed to the `read` tool, absolute or relative to `root`. */
	targetPath: string;
	/** Session working directory; files above it are already loaded by Pi. */
	root: string;
	/** Path -> hash of what the visible transcript already carries. */
	known: ReadonlyMap<string, string>;
	/**
	 * true: re-inject when the file changed on disk.
	 * false: inject once per path for as long as the record stays visible.
	 */
	compareContent?: boolean;
	/**
	 * false when the tool showed only part of `targetPath` itself (`head`, `sed -n`,
	 * a ranged `read`). Reading the context file that way must not record it as
	 * loaded, or the rest of the file never reaches the model.
	 */
	completeTargetRead?: boolean;
	/** Injectable for tests. */
	isFile?: (path: string) => boolean;
	readFile?: (path: string) => string;
};

export type Plan = {
	/** Files to append to the read result, root-most first. */
	attachments: Attachment[];
	/** Records the session must now carry, including a read of the file itself. */
	recorded: FileRecord[];
};

export function hashContent(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

/**
 * Directories from `root` (exclusive) down to the target's directory,
 * root-most first, so general rules precede the ones that refine them.
 * Returns [] when the target lies outside `root`.
 */
export function dirsBetween(targetPath: string, root: string): string[] {
	const absoluteRoot = resolve(root);
	const target = isAbsolute(targetPath) ? resolve(targetPath) : resolve(absoluteRoot, targetPath);
	const rel = relative(absoluteRoot, target);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return [];

	const dirs: string[] = [];
	let current = dirname(target);
	while (current !== absoluteRoot && current !== dirname(current)) {
		const fromRoot = relative(absoluteRoot, current);
		if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return [];
		dirs.push(current);
		current = dirname(current);
	}
	return dirs.reverse();
}

const defaultIsFile = (path: string): boolean => {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
};

const defaultReadFile = (path: string): string => readFileSync(path, "utf-8");

export function contextFileIn(
	dir: string,
	isFile: (path: string) => boolean = defaultIsFile,
): string | undefined {
	for (const name of CONTEXT_FILENAMES) {
		const candidate = join(dir, name);
		if (isFile(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Decide what one successful `read` should attach. Pure apart from the injected
 * filesystem helpers, so the whole policy is testable without starting Pi.
 */
export function planAttachments(input: PlanInput): Plan {
	const { targetPath, root, known } = input;
	const compareContent = input.compareContent ?? true;
	const completeTargetRead = input.completeTargetRead ?? true;
	const isFile = input.isFile ?? defaultIsFile;
	const readFile = input.readFile ?? defaultReadFile;

	const absoluteRoot = resolve(root);
	const target = isAbsolute(targetPath) ? resolve(targetPath) : resolve(absoluteRoot, targetPath);
	const dirs = dirsBetween(target, absoluteRoot);
	if (dirs.length === 0) return { attachments: [], recorded: [] };

	const attachments: Attachment[] = [];
	const recorded: FileRecord[] = [];

	for (const dir of dirs) {
		const file = contextFileIn(dir, isFile);
		if (!file) continue;

		if (file === target) {
			// A full read already hands the model the text; a slice does not, so leave it
			// unrecorded and let a later call load the whole file.
			if (!completeTargetRead) continue;
			try {
				recorded.push({ path: file, sha: hashContent(readFile(file)) });
			} catch {
				// Unreadable: leave it unrecorded so a later read can still inject it.
			}
			continue;
		}

		let content: string;
		try {
			content = readFile(file);
		} catch {
			continue;
		}

		const sha = hashContent(content);
		if (compareContent ? known.get(file) === sha : known.has(file)) continue;

		recorded.push({ path: file, sha });
		attachments.push({ path: file, sha, content });
	}

	return { attachments, recorded };
}
