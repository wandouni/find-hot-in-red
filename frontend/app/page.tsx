import { Suspense } from 'react';
import { fetchNotes } from '@/lib/api';
import { NoteCard } from './components/NoteCard';
import { FilterBar } from './components/FilterBar';

const PAGE_SIZE = 20;

interface SearchParams {
  keyword?: string;
  sort?: string;
  offset?: string;
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const keyword = searchParams.keyword || '';
  const sort = (searchParams.sort as 'likes' | 'collects' | 'date') || 'date';
  const offset = parseInt(searchParams.offset || '0');

  let data;
  try {
    data = await fetchNotes({ keyword, sort, limit: PAGE_SIZE, offset });
  } catch {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-2">无法连接到后端</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  // Get all unique keywords for filter bar (fetch unfiltered for keyword list)
  let allKeywords: string[] = [];
  try {
    const all = await fetchNotes({ limit: 200, sort: 'date' });
    allKeywords = Array.from(new Set(all.items.map((n) => n.keyword).filter(Boolean) as string[]));
  } catch {}

  const totalPages = Math.ceil(data.total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-700">
          数据看板
          <span className="ml-2 text-sm text-gray-400 font-normal">共 {data.total} 篇</span>
        </h1>
      </div>

      <Suspense>
        <FilterBar
          keywords={allKeywords}
          currentKeyword={keyword}
          currentSort={sort}
        />
      </Suspense>

      {data.items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">暂无数据</p>
          <p className="text-sm">请先用 Chrome 插件采集小红书笔记</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              {Array.from({ length: totalPages }, (_, i) => {
                const pageOffset = i * PAGE_SIZE;
                const params = new URLSearchParams();
                if (keyword) params.set('keyword', keyword);
                if (sort !== 'date') params.set('sort', sort);
                if (pageOffset > 0) params.set('offset', String(pageOffset));
                return (
                  <a
                    key={i}
                    href={`/?${params.toString()}`}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      currentPage === i + 1
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                    }`}
                  >
                    {i + 1}
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-400">加载中...</div>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
