import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchNote } from '@/lib/api';

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  let note;
  try {
    note = await fetchNote(params.id);
  } catch {
    notFound();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-red-500 mb-6 transition-colors"
      >
        ← 返回看板
      </Link>

      {/* Note header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          {note.title || '（无标题）'}
        </h1>

        <div className="flex flex-wrap gap-3 text-sm text-gray-500 mb-4">
          <span>
            <span className="font-medium text-gray-700">{note.author || '未知作者'}</span>
          </span>
          {note.keyword && (
            <span className="bg-red-50 text-red-500 rounded px-2 py-0.5">#{note.keyword}</span>
          )}
          {note.publish_date && <span>{note.publish_date}</span>}
        </div>

        <div className="flex gap-6 text-sm mb-4">
          <span className="text-gray-600">❤️ <strong>{note.likes.toLocaleString()}</strong> 点赞</span>
          <span className="text-gray-600">⭐ <strong>{note.collects.toLocaleString()}</strong> 收藏</span>
        </div>

        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-red-400 hover:text-red-600 underline"
          >
            在小红书中查看 ↗
          </a>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3">正文</h2>
        <p className="text-gray-600 leading-relaxed whitespace-pre-wrap text-sm">
          {note.content || '（无正文）'}
        </p>
      </div>

      {/* Comments */}
      {note.comments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-700 mb-4">
            热门评论 <span className="text-gray-400 font-normal text-sm">({note.comments.length}条)</span>
          </h2>
          <div className="space-y-3">
            {note.comments.map((comment) => (
              <div key={comment.id} className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-500 text-xs flex items-center justify-center font-medium">
                  {comment.rank}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-gray-700 leading-relaxed">{comment.content}</p>
                  {comment.likes > 0 && (
                    <span className="text-xs text-gray-400 mt-1">❤️ {comment.likes}</span>
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
