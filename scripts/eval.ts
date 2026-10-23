// Small regression eval for the Q&A pipeline.
//   npm run eval             retrieval only: is the answer-bearing text in the top k? (no API key)
//   npm run eval -- --answers  also generates answers and checks citations / "not found" behavior
import fs from "node:fs";
import { NOT_FOUND, streamAnswer } from "../lib/answer";
import { search } from "../lib/search";

interface Case {
  q: string;
  expect?: string[]; // any of these phrases in a retrieved chunk counts as a hit
  answerable?: boolean;
}

// Next.js loads .env.local for the app; scripts have to do it themselves.
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const K = 6;
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

async function main() {
  const withAnswers = process.argv.includes("--answers");
  const cases: Case[] = JSON.parse(fs.readFileSync("eval/questions.json", "utf8"));
  let hits = 0, mrr = 0, answerable = 0, answerPass = 0, answerTotal = 0;

  for (const c of cases) {
    const results = await search(c.q, K);
    let line = "";
    if (c.expect) {
      answerable++;
      const rank = results.findIndex((h) => c.expect!.some((e) => norm(h.chunk.text).includes(norm(e))));
      if (rank >= 0) { hits++; mrr += 1 / (rank + 1); }
      line = rank >= 0 ? `hit@${rank + 1}` : "MISS ";
    } else {
      line = "  -  ";
    }

    if (withAnswers) {
      const msg = await streamAnswer(c.q, results).finalMessage();
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const refused = text.includes(NOT_FOUND);
      const cited = /\[\d+\]/.test(text);
      const ok = c.answerable === false ? refused : cited && !refused;
      answerTotal++;
      if (ok) answerPass++;
      line += ok ? "  answer ok  " : "  ANSWER BAD ";
      if (!ok) line += `\n      ${text.slice(0, 200).replace(/\n/g, " ")}`;
    }
    console.log(`${line}  ${c.q}`);
  }

  console.log(`\nRetrieval: ${hits}/${answerable} hit@${K}, MRR ${(mrr / answerable).toFixed(2)}`);
  if (withAnswers) console.log(`Answers:   ${answerPass}/${answerTotal} pass (cited when answerable, "${NOT_FOUND}" when not)`);
}

main();
