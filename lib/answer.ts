// Grounded answer generation: the model sees only the retrieved excerpts and
// must cite them by number. Shared by the API route and the eval script.
import Anthropic from "@anthropic-ai/sdk";
import type { Hit } from "./search";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
// Retrieval does the heavy lifting, so low effort keeps answers fast; raise
// to "medium" for multi-part questions that need more synthesis.
const EFFORT = (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high";

// Exact phrase the UI and eval key on when the handbook has no answer.
export const NOT_FOUND = "I couldn't find this in the handbook.";

// Stable system prompt (no per-request content) so it stays cacheable.
const SYSTEM = `You answer questions about the PostHog company handbook for PostHog employees.

Rules:
- Use only the numbered handbook excerpts in the user's message. Do not use outside knowledge about PostHog or anything else.
- Cite every factual claim with the excerpt number in square brackets, like [2] or [1][3]. Only cite excerpts that actually support the claim.
- If the excerpts do not contain the answer, reply with exactly "${NOT_FOUND}" and then, in one sentence, say which related topics the excerpts do cover, if any. Never guess.
- If the excerpts only partly answer the question, answer the part they cover and say plainly what is missing.
- Be concise: lead with the direct answer in one or two sentences, then add short bullet points only if they help. Quote short phrases when exact wording matters (amounts, deadlines, rules).
- Excerpts are extracted from a PDF, so some names and links are missing (you may see gaps like "handled by , , and"). Don't invent the missing names.`;

export function buildUserMessage(question: string, hits: Hit[]): string {
  const sources = hits
    .map(
      (h, i) =>
        `<excerpt id="${i + 1}" article="${h.chunk.title}" pages="${h.chunk.pageStart}-${h.chunk.pageEnd}">\n${h.chunk.text}\n</excerpt>`,
    )
    .join("\n\n");
  return `<handbook_excerpts>\n${sources}\n</handbook_excerpts>\n\nQuestion: ${question}`;
}

let client: Anthropic | null = null;
function getClient() {
  // Org-level keys that span several workspaces must say which one to bill.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  return client;
}

export function streamAnswer(question: string, hits: Hit[]) {
  return getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { effort: EFFORT },
    // On a safety-classifier refusal, the API retries on a suitable fallback
    // model inside the same call instead of returning nothing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: buildUserMessage(question, hits) }],
  });
}
