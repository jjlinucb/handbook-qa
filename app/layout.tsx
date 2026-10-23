import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handbook Q&A",
  description: "Ask questions about the PostHog handbook. Answers cite the handbook.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
