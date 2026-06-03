import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'XHS Insight',
  description: '小红书热门内容分析',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-800 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <span className="text-red-500 font-bold text-xl">XHS</span>
            <span className="text-gray-700 font-semibold">Insight</span>
          </a>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
