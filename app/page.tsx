"use client";

import { useEffect, useRef, useState } from "react";
import type { AskEvent, Source } from "@/lib/events";
import { Answer, citedNumbers } from "./answer";

interface Turn {
  question: string;
  answer: string;
  sources: Source[];
  status: "searching" | "answering" | "done" | "error";
  error?: string;
}

const EXAMPLES = [
  "How much vacation am I expected to take?",
  "What happens to my stock options if I leave?",
  "How do I request new merch?",
  "What should I do before my first on-call shift?",
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const busy = turns.at(-1)?.status === "searching" || turns.at(-1)?.status === "answering";

  const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((ts) => {
      const last = ts[ts.length - 1];
      return [...ts.slice(0, -1), { ...last, ...(typeof patch === "function" ? patch(last) : patch) }];
    });

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    setInput("");
    setTurns((ts) => [...ts, { question, answer: "", sources: [], status: "searching" }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "sources") update({ sources: e.sources, status: "answering" });
          else if (e.type === "text") update((t) => ({ answer: t.answer + e.text }));
          else if (e.type === "error") update({ status: "error", error: e.message });
          else if (e.type === "done") update((t) => (t.status === "error" ? {} : { status: "done" }));
        }
      }
      update((t) => (t.status === "answering" ? { status: "done" } : {}));
    } catch (err) {
      if (ctrl.signal.aborted) update({ status: "done" });
      else update({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <main>
      <header>
        <h1>Handbook Q&amp;A</h1>
        <p className="sub">
          Ask about the PostHog handbook. Answers come only from the handbook and cite the passages they used.
        </p>
      </header>

      {turns.length === 0 && (
        <div className="examples">
          {EXAMPLES.map((q) => (
            <button key={q} onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
      )}

      <div className="turns">
        {turns.map((t, i) => (
          <TurnView key={i} turn={t} />
        ))}
      </div>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What's the travel policy for offsites?"
          maxLength={500}
          autoFocus
          aria-label="Your question"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>Ask</button>
        )}
      </form>
    </main>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cited = citedNumbers(turn.answer);
  const shown = showAll || turn.status !== "done" ? turn.sources : turn.sources.filter((s) => cited.has(s.n));
  const hidden = turn.sources.length - shown.length;
  const ref = useRef<HTMLElement>(null);

  // Bring a new question into view once, when it's asked. Not on every
  // streamed token, which would fight a user scrolling back to read.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <section className="turn" ref={ref}>
      <p className="question">{turn.question}</p>

      {turn.status === "searching" && <p className="muted">Searching the handbook…</p>}
      {turn.answer && <Answer text={turn.answer} onCite={(n) => setOpen(n === open ? null : n)} active={open} />}
      {turn.status === "answering" && !turn.answer && <p className="muted">Reading {turn.sources.length} passages…</p>}
      {turn.status === "error" && <p className="error">{turn.error}</p>}

      {shown.length > 0 && (
        <div className="sources">
          <p className="label">{turn.status === "done" ? "Sources" : "Retrieved passages"}</p>
          {shown.map((s) => (
            <div key={s.n} className={`source ${open === s.n ? "open" : ""}`} id={`src-${s.n}`}>
              <button className="source-head" onClick={() => setOpen(open === s.n ? null : s.n)}>
                <span className="num">{s.n}</span>
                <span className="title">{s.title}</span>
                <span className="pages">p. {s.pageStart === s.pageEnd ? s.pageStart : `${s.pageStart}–${s.pageEnd}`}</span>
              </button>
              {open === s.n && (
                <div className="excerpt">
                  <pre>{s.excerpt}</pre>
                  <a href={s.url} target="_blank" rel="noreferrer">Open on posthog.com ↗</a>
                </div>
              )}
            </div>
          ))}
          {turn.status === "done" && hidden > 0 && (
            <button className="link" onClick={() => setShowAll(true)}>
              Show {hidden} other retrieved passage{hidden > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
