'use client';

import { useState } from 'react';

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

interface ExportButtonProps {
  taskId: number;
  taskMeta: {
    keywords: string[];
    period: string;
    date: string;
  };
}

export function ExportButton({ taskId }: ExportButtonProps) {
  const [state, setState] = useState<'idle' | 'copying' | 'done'>('idle');

  const base = `http://localhost:8000/api/export`;
  const qs = `?task_id=${taskId}`;

  async function copyMd() {
    setState('copying');
    try {
      const res = await fetch(`${base}/notes.md${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('idle');
      alert('复制失败，请使用「导出 MD」按钮下载后手动复制');
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={copyMd}
        disabled={state === 'copying'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-60
          ${state === 'done'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
          }`}
      >
        {state === 'done' ? (
          <><CheckIcon />已复制</>
        ) : state === 'copying' ? (
          '复制中...'
        ) : (
          <><CopyIcon />复制 MD</>
        )}
      </button>

      <a
        href={`${base}/notes.md${qs}`}
        download
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                   bg-blue-50 text-blue-700 border border-blue-200
                   hover:bg-blue-100 hover:border-blue-300 transition-colors"
      >
        <DownloadIcon />
        导出 MD
      </a>

      <a
        href={`${base}/notes${qs}`}
        download
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                   bg-green-50 text-green-700 border border-green-200
                   hover:bg-green-100 hover:border-green-300 transition-colors"
      >
        <DownloadIcon />
        导出 Excel
      </a>
    </div>
  );
}
