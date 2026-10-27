/**
 * Key used inside a read result's `details`. It travels with the message, so the
 * session itself remembers what was injected instead of a process-local cache.
 */
export const DETAILS_KEY = "agentsMdContext";

/** Same filename precedence Pi uses for its own context files. */
export const CONTEXT_FILENAMES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"] as const;

/** One injected file: absolute path plus the hash of the text the model saw. */
export type FileRecord = { path: string; sha: string };
