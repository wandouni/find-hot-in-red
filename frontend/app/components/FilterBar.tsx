'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const SORT_OPTIONS = [
  { value: 'date', label: '最新' },
  { value: 'likes', label: '点赞最多' },
  { value: 'collects', label: '收藏最多' },
];

interface Props {
  taskId: number;
  keywords: string[];
  currentKeyword: string;
  currentSort: string;
}

export function FilterBar({ taskId, keywords, currentKeyword, currentSort }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    p.set('task_id', String(taskId));
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete('offset');
    router.push(`/?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      {keywords.length > 1 && (
        <select
          value={currentKeyword}
          onChange={(e) => update('keyword', e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">全部关键词</option>
          {keywords.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      )}

      <div className="flex gap-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => update('sort', opt.value)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              currentSort === opt.value
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
