// Renders the model's answer: paragraphs, bullet/numbered lists, **bold**,
// `code`, and [n] citations as clickable chips. Deliberately tiny instead of a
// full Markdown library, since the system prompt keeps the format simple.
import type { ReactNode } from "react";

const CITE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export function citedNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(CITE)) m[1].split(",").forEach((n) => out.add(Number(n.trim())));
  return out;
}

function inline(text: string, onCite: (n: number) => void, active: number | null): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+(?:\s*,\s*\d+)*\])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={m.index}>{tok.slice(1, -1)}</code>);
    else
      tok.slice(1, -1).split(",").forEach((n, j) => {
        const num = Number(n.trim());
        parts.push(
          <button key={`${m.index}-${j}`} className={`cite ${active === num ? "on" : ""}`} onClick={() => onCite(num)}>
            {num}
          </button>,
        );
      });
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Answer({ text, onCite, active }: { text: string; onCite: (n: number) => void; active: number | null }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, onCite, active)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""), onCite, active)}</p>);
    }
  }
  flushList();
  return <div className="answer">{blocks}</div>;
}
