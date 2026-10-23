# Handbook Q&A

Ask questions about the PostHog company handbook in plain English. Every answer comes from the handbook, cites the passages it used, and links each one to its page on posthog.com. If the handbook doesn't cover something, the app says so instead of guessing.

## Run it

Needs Node 22 or newer (`.nvmrc` pins 24) and an Anthropic API key.

```bash
npm install
cp .env.example .env.local   # then paste your key into ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

The search index is already built and committed in `data/`, so you don't need the PDF to run the app. The first question takes a few extra seconds while the embedding model (about 33 MB) downloads and caches.

To rebuild the index from the PDF:

```bash
# put the handbook at handbook/handbook.pdf (it's 50 MB, so it isn't committed)
npm run ingest
```

To run the eval:

```bash
npm run eval              # retrieval only, no API key needed
npm run eval -- --answers # also generates answers and checks them
```

## How it works

```
question
   |
   +--> BM25 keyword search ----+
   |                            +--> Reciprocal Rank Fusion --> top 6 chunks
   +--> embedding search -------+                                   |
                                                                    v
                                     Claude, told to use only these excerpts
                                     and cite them as [1], [2], ...
                                                                    |
                                     streamed to the UI with the sources
```

**Ingest** (`scripts/ingest.ts`, `lib/chunk.ts`). The handbook is a 1,076-page print of posthog.com/handbook, about 420k tokens. That's too big to send with every question, so the app retrieves. Each article in the PDF starts with its title and its source path (`contents/handbook/people/spending-money.md`). I split on that, which gives 254 articles with clean boundaries plus a real URL for each citation. Each article is cut into chunks of about 300 words that overlap by 50, so an answer that falls across a boundary still lands whole in one chunk. That makes 1,365 chunks. The repeating browser header and footer on every page are stripped out, and each chunk keeps its page range.

**Retrieval** (`lib/search.ts`, `lib/bm25.ts`, `lib/embed.ts`). Two retrievers run on every question:
- BM25 catches exact terms like "keeper test", "SOC 2" or "Brex", which embeddings tend to blur.
- Embeddings (`bge-small-en-v1.5`, run locally through transformers.js) catch paraphrases. "Can I take as much time off as I want?" finds the "unlimited vacation" passage even though the words don't match.

Their rankings are merged with Reciprocal Rank Fusion. RRF works on ranks, not scores, so BM25 scores never have to be calibrated against cosine similarities. The article title is prepended to each chunk before indexing, so a chunk from the middle of "Spending money" still matches a question about expenses.

**Answering** (`lib/answer.ts`). The top 6 chunks go to Claude (`claude-opus-5-5`) as numbered excerpts. The system prompt tells it to use only those excerpts, cite every claim, and reply "I couldn't find this in the handbook" when the excerpts don't hold the answer. Effort is set to `low` because retrieval has already done the hard part. You can override the model and effort in `.env.local`.

**API and UI** (`app/api/ask/route.ts`, `app/page.tsx`). The route streams newline-delimited JSON. The sources arrive first, then the answer text as it's generated, so the user sees what's being read before the answer starts. In the UI, citations are clickable chips that open the excerpt, and each source links to the live handbook page. After the answer finishes, only the sources it actually cited are shown. The other retrieved passages sit behind a toggle.

## Error handling and defaults

- Empty or overlong questions (over 500 characters) are rejected with a clear message.
- A missing API key, a rejected key, rate limits and network failures each get their own plain-English message, not a stack trace.
- Requests can be stopped mid-answer, and stopping cancels the upstream model call.
- Server-side fallbacks are on. If a safety classifier declines a request, the API retries on a fallback model instead of returning nothing.
- If the answer hits the length limit, the UI says so.

## Eval

`eval/questions.json` holds 12 questions whose answers I checked by hand against the handbook, plus 2 it can't answer. Retrieval is scored by whether a chunk containing the answer phrase shows up in the top 6.

Current result: **retrieval 11/12 hit@6, MRR 0.75. Answers 14/14 pass.**

The one miss is a good example of where retrieval falls short. "Is there a budget for meeting up with teammates in person?" should find "$1,500 quarterly travel budget for ad-hoc meetups", but that line sits in a list of perks on the Culture page. Both retrievers rank the Offsites pages higher, which are a reasonable answer to a different reading of the question. I left the miss in rather than tune the question to pass.

`--answers` mode also checks that answerable questions come back with citations and that unanswerable ones come back with the not-found phrase.

## Assumptions and limitations

- **One question at a time.** Each question is searched on its own, so a follow-up like "what about contractors?" loses the context of the previous question. The next step would be rewriting follow-ups into standalone questions before searching.
- **The PDF lost some text.** Names and links that were rendered as links on the website came out blank in the PDF ("handled by , , and on the team"). The prompt tells the model not to fill those gaps in, and the posthog.com link on each source lets a user see the original.
- **No headings.** Plain PDF text doesn't mark section headings, so chunks are cut by length within an article, not by section.
- **It's a snapshot.** The index reflects the PDF printed on 4/20/26. Rerun `npm run ingest` on a newer PDF to refresh it.
- **Scale.** Brute-force vector search over 1,365 chunks takes a few milliseconds. A handbook 100 times larger would want a real vector index.
- **No auth and no persistence.** It's a local tool. Conversations live in the browser tab.

## How I used AI

<!-- John: rewrite this section in your own words before submitting. -->

I built this with Claude Code as a pair programmer. I set the direction: hybrid retrieval over sending the whole document, Next.js, local embeddings so reviewers only need one API key, and an eval before tuning anything. Claude Code wrote most of the first draft of the code. I reviewed each piece, ran it, and checked the answers it gave against the handbook myself.

Some things I verified by hand instead of trusting:
- The article-boundary pattern, by reading the raw extracted text of the PDF.
- Every eval answer, against the handbook text.
- The retrieval miss described above, by looking at what each retriever actually ranked.

The app uses Claude at runtime for answer generation only. Retrieval is ordinary code (BM25 and cosine similarity) that you can inspect and test without calling a model.
