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
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
          <span className="text-red-500 font-bold text-xl">XHS</span>
          <span className="text-gray-700 font-semibold">Insight</span>
          <nav className="flex items-center gap-1 ml-4">
            <a
              href="/"
              className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              数据看板
            </a>
            <a
              href="/tasks"
              className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              采集任务
            </a>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
