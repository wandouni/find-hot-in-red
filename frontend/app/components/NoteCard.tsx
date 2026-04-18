import Link from 'next/link';
import type { Note } from '@/lib/api';

export function NoteCard({ note }: { note: Note }) {
  return (
    <Link href={`/notes/${note.id}`}>
      <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-red-200 transition-all cursor-pointer">
        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-2 text-sm leading-snug">
          {note.title || '（无标题）'}
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <span className="bg-gray-100 rounded px-2 py-0.5">{note.author || '未知作者'}</span>
          {note.keyword && (
            <span className="bg-red-50 text-red-500 rounded px-2 py-0.5">#{note.keyword}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>❤️ {note.likes.toLocaleString()}</span>
          <span>⭐ {note.collects.toLocaleString()}</span>
          <span className="ml-auto">{note.publish_date || ''}</span>
        </div>
      </div>
    </Link>
  );
}
