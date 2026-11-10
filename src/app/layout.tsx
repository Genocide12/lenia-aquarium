import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const manrope = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Ления — живой аквариум искусственной жизни",
  description:
    "Цифровые существа, которые рождаются, плавают, сталкиваются и делятся, — прямо в браузере. Интерактивная реконструкция Лении Бёрта Чана: дневник наблюдений, живой атлас видов, первичный бульон. Понятно в любом возрасте.",
  keywords: ["Ления", "Lenia", "клеточные автоматы", "Game of Life", "искусственная жизнь", "ALife", "WebGL", "аквариум"],
  authors: [{ name: "Z.ai" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Ления — живой аквариум искусственной жизни",
    description: "Существа рождаются, плавают и делятся по трём математическим правилам — прямо в вашем браузере",
    siteName: "Z.ai",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
