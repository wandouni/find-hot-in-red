import { notFound } from 'next/navigation';
import { fetchNote } from '@/lib/api';

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  let note;
  try {
    note = await fetchNote(params.id);
  } catch {
    notFound();
  }

  const backHref = note.task_id ? `/?task_id=${note.task_id}` : '/';

  return (
    <div className="max-w-2xl mx-auto">
      <a
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-red-500 mb-5 transition-colors"
      >
        ← 返回
      </a>

      {/* Note header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-3">
        <h1 className="text-lg font-semibold text-gray-900 mb-3 leading-snug">
          {note.title || '（无标题）'}
        </h1>

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-3">
          <span className="font-medium text-gray-700">{note.author || '未知作者'}</span>
          {note.keyword && (
            <span className="bg-red-50 text-red-500 rounded px-2 py-0.5">{note.keyword}</span>
          )}
          {note.publish_date && <span>{note.publish_date}</span>}
        </div>

        <div className="flex gap-5 text-sm text-gray-600 mb-3">
          <span>❤️ <strong>{note.likes.toLocaleString()}</strong></span>
          <span>⭐ <strong>{note.collects.toLocaleString()}</strong></span>
        </div>

        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-red-400 hover:text-red-600 underline"
          >
            在小红书中查看 ↗
          </a>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-3">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">正文</h2>
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">
          {note.content || '（无正文）'}
        </p>
      </div>

      {/* Comments */}
      {note.comments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            热门评论 · {note.comments.length}条
          </h2>
          <div className="space-y-2.5">
            {note.comments.map((comment) => (
              <div key={comment.id} className="flex gap-2.5 py-2 border-b border-gray-50 last:border-0">
                <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center">
                  {comment.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 leading-relaxed">{comment.content}</p>
                  {comment.likes > 0 && (
                    <span className="text-xs text-gray-400 mt-0.5 block">❤️ {comment.likes}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
