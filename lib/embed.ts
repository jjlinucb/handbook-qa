// Local sentence embeddings, so the app needs no second API key.
// bge-small-en-v1.5: 384 dimensions, ~33MB, downloaded once and cached.
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBED_DIM = 384;
// bge models expect this prefix on queries (not on passages).
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  extractor ??= pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
  return extractor;
}

// Returns L2-normalized vectors, so cosine similarity is a plain dot product.
export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  const fx = await getExtractor();
  const out = await fx(texts, { pooling: "cls", normalize: true });
  const flat = out.data as Float32Array;
  return texts.map((_, i) => flat.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const [v] = await embedPassages([QUERY_PREFIX + query]);
  return v;
}
