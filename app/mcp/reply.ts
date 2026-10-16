import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** How every CampusEvac tool answers: a sentence to read aloud, then the same answer as data. */
export const answer = (speech: string, data: Record<string, unknown>): CallToolResult => ({
  content: [
    { type: "text", text: speech },
    { type: "text", text: JSON.stringify(data) },
  ],
  structuredContent: { speech, ...data },
});

export const refuse = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
