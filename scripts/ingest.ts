// Builds the search index from the handbook PDF.
//   npm run ingest [-- path/to/handbook.pdf]
// Writes data/chunks.json (text + metadata) and data/embeddings.bin
// (Float32, chunk-major, EMBED_DIM floats per chunk).
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkHandbook, searchableText } from "../lib/chunk";
import { embedPassages, EMBED_DIM, EMBED_MODEL } from "../lib/embed";

const pdfPath = process.argv[2] ?? "handbook/handbook.pdf";
const outDir = "data";
const BATCH = 32;

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error(`No PDF at ${pdfPath}. Download the handbook there first (see README).`);
    process.exit(1);
  }

  console.time("extract");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(pdfPath)));
  const { text: pages } = await extractText(pdf, { mergePages: false });
  console.timeEnd("extract");

  const chunks = chunkHandbook(pages);
  const articles = new Set(chunks.map((c) => c.path)).size;
  console.log(`${pages.length} pages -> ${articles} articles -> ${chunks.length} chunks`);

  console.time("embed");
  const vectors = new Float32Array(chunks.length * EMBED_DIM);
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH).map(searchableText);
    const embs = await embedPassages(batch);
    embs.forEach((v, j) => vectors.set(v, (i + j) * EMBED_DIM));
    process.stdout.write(`\r  embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }
  process.stdout.write("\n");
  console.timeEnd("embed");

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "chunks.json"),
    JSON.stringify({ model: EMBED_MODEL, dim: EMBED_DIM, source: path.basename(pdfPath), chunks }),
  );
  fs.writeFileSync(path.join(outDir, "embeddings.bin"), Buffer.from(vectors.buffer));
  console.log(`Wrote ${outDir}/chunks.json and ${outDir}/embeddings.bin`);
}

main();
