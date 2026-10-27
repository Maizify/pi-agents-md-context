import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Commands whose first word means "show me a file's content". Pi's `read` tool
 * is often replaced by these in practice; treating them as the same channel is
 * what keeps nested context loading independent of the harness's tool choice.
 *
 * `grep`, `rg`, `ls` and `find` are deliberately absent: they search or list,
 * and their targets are many files or whole trees.
 */
const READ_COMMANDS = new Set(["cat", "bat", "less", "head", "tail", "sed", "awk"]);

/** Prefix words that do not change which command runs. */
const PREFIX_WORDS = new Set(["sudo", "command", "time", "nohup", "exec"]);

const REDIRECT = /^(?:\d*)(?:>>?|<<?)/;

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Split a shell command into segments at `&&`, `||`, `;`, `|` and newlines. */
export function segments(command: string): string[][] {
	const out: string[][] = [];
	let tokens: string[] = [];
	let buffer = "";
	let quote: string | null = null;

	const pushToken = () => {
		if (buffer !== "") tokens.push(buffer);
		buffer = "";
	};
	const pushSegment = () => {
		pushToken();
		if (tokens.length > 0) out.push(tokens);
		tokens = [];
	};

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (quote) {
			if (ch === quote) quote = null;
			else if (ch === "\\" && quote === '"' && i + 1 < command.length) buffer += command[++i];
			else buffer += ch;
			continue;
		}

		if (ch === "\\" && i + 1 < command.length) {
			buffer += command[++i];
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (ch === "\n") pushSegment();
			else pushToken();
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&") {
			const pair = command[i + 1] === ch;
			pushSegment();
			if (pair) i++;
			continue;
		}

		buffer += ch;
	}

	pushSegment();
	return out;
}

/** Drop the command word's prefixes (`sudo`, `VAR=value`, …) and returns the rest. */
function stripPrefixes(tokens: string[]): string[] {
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		if (PREFIX_WORDS.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
			i++;
			continue;
		}
		break;
	}
	return tokens.slice(i);
}

/** A token that cannot be resolved statically: glob, variable, substitution. */
function isDynamic(token: string): boolean {
	return /[*?$`]|\$\(/.test(token);
}

export type ReadTargetOptions = {
	cwd: string;
	isFile?: (path: string) => boolean;
	isDirectory?: (path: string) => boolean;
};

/**
 * Absolute paths this command reads the content of, in order.
 *
 * `cd` only moves the base directory for later segments; it never yields a
 * target itself, so a bare `cd repo/pkg` loads nothing.
 */
export function bashReadTargets(command: string, options: ReadTargetOptions): string[] {
	const fileTest = options.isFile ?? isFile;
	const dirTest = options.isDirectory ?? isDir;
	const start = isAbsolute(options.cwd) ? options.cwd : resolve(options.cwd);

	let currentDir = start;
	const targets: string[] = [];
	const seen = new Set<string>();

	for (const raw of segments(command)) {
		const tokens = stripPrefixes(raw);
		if (tokens.length === 0) continue;

		const head = tokens[0];

		if (head === "cd") {
			const arg = tokens.slice(1).find((token) => !token.startsWith("-"));
			if (!arg || arg === "-" || isDynamic(arg)) continue;
			const dir = resolve(currentDir, arg);
			if (dirTest(dir)) currentDir = dir;
			continue;
		}

		if (!READ_COMMANDS.has(head)) continue;
		// `sed -i` rewrites the file in place; that is a write, not a read.
		if (head === "sed" && tokens.some((token) => /^-i/.test(token))) continue;

		let skipNext = false;
		for (const token of tokens.slice(1)) {
			if (skipNext) {
				skipNext = false;
				continue;
			}
			if (token.startsWith("-") || REDIRECT.test(token)) {
				if (REDIRECT.test(token)) skipNext = true;
				continue;
			}
			if (isDynamic(token)) continue;
			const path = resolve(currentDir, token);
			if (!fileTest(path)) continue;
			if (seen.has(path)) continue;
			seen.add(path);
			targets.push(path);
		}
	}

	return targets;
}
