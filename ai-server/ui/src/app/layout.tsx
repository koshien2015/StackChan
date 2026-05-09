import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StackChan Chat",
  description: "StackChan AI chat interface",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={`${geist.className} h-full`}>
      <body className="h-full bg-slate-900 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
