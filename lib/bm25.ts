// Minimal BM25 keyword index. Catches exact terms (names, acronyms, "SOC 2",
// "401k") that embeddings tend to blur.

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from how i if in is it of on or our should so that the their there this to we what when where which who why will with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)); // crude plural folding
}

export class BM25 {
  private df = new Map<string, number>();
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private avgLen = 0;

  constructor(docs: string[], private k1 = 1.2, private b = 0.75) {
    for (const doc of docs) {
      const counts = new Map<string, number>();
      const toks = tokenize(doc);
      for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.tf.push(counts);
      this.len.push(toks.length);
    }
    this.avgLen = this.len.reduce((a, b) => a + b, 0) / Math.max(docs.length, 1);
  }

  // Returns doc indexes ranked by score, best first.
  search(query: string, k: number): number[] {
    const n = this.tf.length;
    const terms = [...new Set(tokenize(query))];
    const scores = new Float64Array(n);
    for (const t of terms) {
      const df = this.df.get(t);
      if (!df) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < n; i++) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const norm = 1 - this.b + (this.b * this.len[i]) / this.avgLen;
        scores[i] += (idf * f * (this.k1 + 1)) / (f + this.k1 * norm);
      }
    }
    return [...scores.keys()]
      .filter((i) => scores[i] > 0)
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, k);
  }
}
