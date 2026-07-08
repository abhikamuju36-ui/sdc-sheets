import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";

// Web/social headline font per the SDC Brand Guide — closest web-safe match to
// the brand's print font (Core Sans NR). Body/mono text uses the OS's native
// font stack instead (see globals.css) — crisper and no download needed.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  weight: ["600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SDC ETC Planner",
  description: "Estimate-to-complete tracking for SDC projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
