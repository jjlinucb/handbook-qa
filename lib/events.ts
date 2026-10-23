// Wire format between /api/ask and the UI (one JSON object per line).
export type AskEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface Source {
  n: number;
  title: string;
  url: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
}
