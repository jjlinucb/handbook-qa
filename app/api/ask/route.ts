// POST /api/ask  { question }  ->  NDJSON stream of events:
//   {"type":"sources","sources":[...]}   once, before any text
//   {"type":"text","text":"..."}         answer deltas
//   {"type":"done"} | {"type":"error","message":"..."}
import Anthropic from "@anthropic-ai/sdk";
import { streamAnswer } from "@/lib/answer";
import type { AskEvent } from "@/lib/events";
import { search } from "@/lib/search";

export const runtime = "nodejs"; // needs fs + onnxruntime for local embeddings

const MAX_QUESTION_CHARS = 500;
const TOP_K = 6;

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your network connection.";
  if (err instanceof Anthropic.APIError) return `The model request failed (${err.status ?? "unknown status"}). Try again.`;
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "Ask a question first." }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return Response.json({ error: `Keep questions under ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AskEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const hits = await search(question, TOP_K);
        send({
          type: "sources",
          sources: hits.map((h, i) => ({
            n: i + 1,
            title: h.chunk.title,
            url: h.chunk.url,
            pageStart: h.chunk.pageStart,
            pageEnd: h.chunk.pageEnd,
            excerpt: h.chunk.text,
          })),
        });

        const answer = streamAnswer(question, hits);
        req.signal.addEventListener("abort", () => answer.abort());
        for await (const event of answer) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "text", text: event.delta.text });
          }
        }
        const final = await answer.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", message: "The model declined to answer this question." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "text", text: "\n\n_(Answer cut off at the length limit.)_" });
        }
        send({ type: "done" });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error(err);
          send({ type: "error", message: errorMessage(err) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
