'use client';

interface ExportButtonProps {
  keyword?: string;
}

export function ExportButton({ keyword }: ExportButtonProps) {
  const href =
    'http://localhost:8000/api/export/notes' +
    (keyword ? `?keyword=${encodeURIComponent(keyword)}` : '');

  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                 bg-green-50 text-green-700 border border-green-200
                 hover:bg-green-100 hover:border-green-300 transition-colors"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-4 h-4"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
      {keyword ? `导出「${keyword}」` : '导出全部'} Excel
    </a>
  );
}
