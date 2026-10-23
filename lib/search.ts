// Hybrid retrieval: BM25 keywords + dense embeddings, fused with Reciprocal
// Rank Fusion. Loaded once per server process and kept in memory (~5MB).
import fs from "node:fs";
import path from "node:path";
import { BM25 } from "./bm25";
import { searchableText, type Chunk } from "./chunk";
import { embedQuery, EMBED_DIM } from "./embed";

export interface Hit {
  chunk: Chunk;
  score: number; // RRF score, only meaningful relative to other hits
  dense: number; // cosine similarity of the query to this chunk
}

interface Index {
  chunks: Chunk[];
  vectors: Float32Array;
  bm25: BM25;
}

const CANDIDATES = 30; // per retriever, before fusion
const RRF_K = 60; // standard constant from the RRF paper

let index: Index | null = null;

export function loadIndex(dataDir = path.join(process.cwd(), "data")): Index {
  if (index) return index;
  const chunksFile = path.join(dataDir, "chunks.json");
  if (!fs.existsSync(chunksFile)) {
    throw new Error("Search index not found. Run `npm run ingest` first.");
  }
  const { chunks } = JSON.parse(fs.readFileSync(chunksFile, "utf8")) as { chunks: Chunk[] };
  const buf = fs.readFileSync(path.join(dataDir, "embeddings.bin"));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  if (vectors.length !== chunks.length * EMBED_DIM) {
    throw new Error("embeddings.bin does not match chunks.json. Re-run `npm run ingest`.");
  }
  index = { chunks, vectors, bm25: new BM25(chunks.map(searchableText)) };
  return index;
}

function denseRank(q: Float32Array, vectors: Float32Array, n: number, k: number) {
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * EMBED_DIM;
    for (let d = 0; d < EMBED_DIM; d++) s += q[d] * vectors[off + d];
    sims[i] = s;
  }
  const ranked = [...sims.keys()].sort((a, b) => sims[b] - sims[a]).slice(0, k);
  return { ranked, sims };
}

export async function search(query: string, k = 6): Promise<Hit[]> {
  const { chunks, vectors, bm25 } = loadIndex();
  const q = await embedQuery(query);
  const { ranked: dense, sims } = denseRank(q, vectors, chunks.length, CANDIDATES);
  const keyword = bm25.search(query, CANDIDATES);

  // RRF: each retriever contributes 1/(k + rank). Rank-based, so we never
  // have to calibrate BM25 scores against cosine similarities.
  const fused = new Map<number, number>();
  for (const list of [dense, keyword]) {
    list.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  }

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, score]) => ({ chunk: chunks[id], score, dense: sims[id] }));
}
