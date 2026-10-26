// Turns the handbook PDF's per-page text into retrievable chunks.
//
// The PDF is a print of posthog.com/handbook. Every article starts with its
// title on one line and its source path ("contents/handbook/....md") on the
// next, which gives us clean article boundaries and a real URL to cite.

export interface Chunk {
  id: number;
  title: string; // article title, e.g. "Spending money"
  path: string; // "contents/handbook/people/spending-money.md"
  url: string; // "https://posthog.com/handbook/people/spending-money"
  pageStart: number; // 1-indexed PDF page
  pageEnd: number;
  text: string;
}

const SOURCE_PATH = /^contents\/\S+\.md$/;
// Browser print header/footer that repeats on every page.
const PAGE_NOISE = [
  /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} [AP]M PostHog handbook$/,
  /^file:\/\/\/\S+ \d+\/\d+$/,
  /^PostHog handbook$/,
];

const TARGET_WORDS = 300;
const OVERLAP_WORDS = 50;

interface Line {
  text: string;
  page: number;
}

interface Article {
  title: string;
  path: string;
  lines: Line[];
}

export function pathToUrl(path: string): string {
  const slug = path.replace(/^contents\//, "").replace(/(\/index)?\.md$/, "");
  return `https://posthog.com/${slug}`;
}

function cleanLines(pages: string[]): Line[] {
  const out: Line[] = [];
  pages.forEach((pageText, i) => {
    for (const raw of pageText.split("\n")) {
      const text = raw.trim();
      if (!text || PAGE_NOISE.some((re) => re.test(text))) continue;
      out.push({ text, page: i + 1 });
    }
  });
  return out;
}

function splitArticles(lines: Line[]): Article[] {
  const articles: Article[] = [];
  let current: Article | null = null;
  let body: Line[] = []; // lines since the last path line
  for (const line of lines) {
    if (!SOURCE_PATH.test(line.text)) {
      body.push(line);
      continue;
    }
    // Every article starts on a fresh page, so its title is all the text above
    // the path on that page. Long titles wrap onto a second line.
    const titleLines: Line[] = [];
    while (body.at(-1)?.page === line.page) titleLines.unshift(body.pop()!);
    if (current) current.lines = body;
    current = { title: titleLines.map((l) => l.text).join(" "), path: line.text, lines: [] };
    articles.push(current);
    body = [];
  }
  if (current) current.lines = body;
  return articles.filter((a) => a.lines.length > 0);
}

// Greedy line packing: fill a chunk to ~TARGET_WORDS, then start the next one
// with the last ~OVERLAP_WORDS so an answer split across a boundary still
// lands whole in at least one chunk.
function chunkArticle(article: Article): Omit<Chunk, "id">[] {
  const chunks: Omit<Chunk, "id">[] = [];
  let buf: Line[] = [];
  let words = 0;

  const flush = () => {
    if (buf.length === 0) return;
    chunks.push({
      title: article.title,
      path: article.path,
      url: pathToUrl(article.path),
      pageStart: buf[0].page,
      pageEnd: buf[buf.length - 1].page,
      text: buf.map((l) => l.text).join("\n"),
    });
  };

  for (const line of article.lines) {
    const n = line.text.split(/\s+/).length;
    if (words + n > TARGET_WORDS && words > 0) {
      flush();
      const overlap: Line[] = [];
      let ow = 0;
      for (let j = buf.length - 1; j >= 0 && ow < OVERLAP_WORDS; j--) {
        overlap.unshift(buf[j]);
        ow += buf[j].text.split(/\s+/).length;
      }
      buf = overlap;
      words = ow;
    }
    buf.push(line);
    words += n;
  }
  flush();
  return chunks;
}

export function chunkHandbook(pages: string[]): Chunk[] {
  return splitArticles(cleanLines(pages))
    .flatMap(chunkArticle)
    .map((c, id) => ({ id, ...c }));
}

// What gets embedded and keyword-indexed: the title is prepended so a chunk
// deep inside "Spending money" still matches a question about expenses.
export function searchableText(c: Pick<Chunk, "title" | "text">): string {
  return `${c.title}\n${c.text}`;
}
