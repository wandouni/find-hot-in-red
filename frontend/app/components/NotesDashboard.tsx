'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  fetchNotes, fetchTask, deleteNote, deleteNotes,
  DATE_FILTER_LABEL, type Task, type Note,
} from '@/lib/api';
import { ExportButton } from './ExportButton';

const PAGE_SIZE = 30;

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

interface Props {
  taskId: number;
  initialKeyword: string;
  initialSort: string;
  initialOffset: number;
}

export function NotesDashboard({ taskId, initialKeyword, initialSort, initialOffset }: Props) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [sort, setSort] = useState(initialSort);
  const [offset, setOffset] = useState(initialOffset);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const buildUrl = useCallback((kw: string, s: string, off: number) => {
    const p = new URLSearchParams();
    p.set('task_id', String(taskId));
    if (kw) p.set('keyword', kw);
    if (s !== 'date') p.set('sort', s);
    if (off > 0) p.set('offset', String(off));
    return `/?${p.toString()}`;
  }, [taskId]);

  const loadNotes = useCallback(async (kw: string, s: string, off: number) => {
    setLoading(true);
    try {
      setError(false);
      const data = await fetchNotes({
        task_id: taskId,
        keyword: kw || undefined,
        sort: s as 'likes' | 'collects' | 'date',
        limit: PAGE_SIZE,
        offset: off,
      });
      setNotes(data.items);
      setTotal(data.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask(taskId).then(setTask).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    loadNotes(keyword, sort, offset);
    setSelected(new Set());
  }, [keyword, sort, offset, loadNotes]);

  function updateFilter(kw: string, s: string, off: number) {
    setKeyword(kw);
    setSort(s);
    setOffset(off);
    router.replace(buildUrl(kw, s, off), { scroll: false });
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev =>
      prev.size === notes.length ? new Set() : new Set(notes.map(n => n.id))
    );
  }

  async function handleDeleteSelected() {
    if (!confirm(`确定删除选中的 ${selected.size} 条笔记？`)) return;
    setBusy(true);
    try {
      await deleteNotes(Array.from(selected));
      setSelected(new Set());
      await loadNotes(keyword, sort, offset);
    } catch {
      alert('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('确定删除该条笔记？')) return;
    setBusy(true);
    try {
      await deleteNote(id);
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      await loadNotes(keyword, sort, offset);
    } catch {
      alert('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const keywords = task?.keywordList ?? [];
  const period = DATE_FILTER_LABEL[task?.date_filter ?? 0] ?? '不限';
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const allSelected = notes.length > 0 && selected.size === notes.length;

  if (error) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="mb-1">无法加载方案数据</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="text-gray-400 hover:text-red-500 transition-colors text-sm shrink-0">
            ←
          </a>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {keywords.map(kw => (
              <span key={kw} className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600">
                {kw}
              </span>
            ))}
            {task?.date_filter ? (
              <span className="text-xs text-orange-500">{period}</span>
            ) : null}
            <span className="text-xs text-gray-400">{total} 篇</span>
          </div>
        </div>
        <ExportButton
          taskId={taskId}
          taskMeta={{ keywords, period, date: task?.created_at ?? '' }}
        />
      </div>

      {/* Filter bar — keyword selector + bulk delete */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {notes.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-gray-300 cursor-pointer"
            title={allSelected ? '取消全选' : '全选本页'}
          />
        )}

        {keywords.length > 1 && (
          <select
            value={keyword}
            onChange={(e) => updateFilter(e.target.value, sort, 0)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
          >
            <option value="">全部</option>
            {keywords.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}

        {selected.size > 0 && (
          <button
            onClick={handleDeleteSelected}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs
                       text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
          >
            <TrashIcon /> 删除 ({selected.size})
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">加载中...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-1">该方案暂无数据</p>
          <p className="text-sm">采集完成后笔记将显示在这里</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {/* Header row — 点赞 / 收藏 / 发布时间 are clickable sort triggers */}
            <div className="flex items-center gap-3 px-4 py-2 text-xs select-none">
              <span className="shrink-0 w-4" />
              <span className="flex-1 min-w-0 text-gray-400">标题</span>
              <span className="shrink-0 w-20 text-right hidden sm:block text-gray-400">作者</span>
              <span className="shrink-0 w-20 hidden md:block text-gray-400">关键词</span>
              <button
                onClick={() => updateFilter(keyword, 'likes', 0)}
                className={`shrink-0 w-16 text-right transition-colors cursor-pointer
                  ${sort === 'likes' ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
              >
                点赞{sort === 'likes' ? ' ↓' : ''}
              </button>
              <button
                onClick={() => updateFilter(keyword, 'collects', 0)}
                className={`shrink-0 w-16 text-right transition-colors cursor-pointer
                  ${sort === 'collects' ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
              >
                收藏{sort === 'collects' ? ' ↓' : ''}
              </button>
              <button
                onClick={() => updateFilter(keyword, 'date', 0)}
                className={`shrink-0 w-14 text-right transition-colors cursor-pointer
                  ${sort === 'date' ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
              >
                发布时间{sort === 'date' ? ' ↓' : ''}
              </button>
              <span className="shrink-0 w-6" />
            </div>

            {notes.map((note) => {
              const isSelected = selected.has(note.id);
              return (
                <div
                  key={note.id}
                  className={`flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-50 transition-colors
                    ${isSelected ? 'bg-red-50' : ''}`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={(e) => toggleSelect(note.id, e)}
                    className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all
                      ${isSelected
                        ? 'bg-red-500 border-red-500'
                        : 'bg-white border-gray-300 opacity-0 group-hover:opacity-100'
                      }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  {/* Title */}
                  <Link
                    href={`/notes/${note.id}`}
                    className="flex-1 min-w-0 text-sm text-gray-800 hover:text-red-500 transition-colors truncate"
                  >
                    {note.title || '（无标题）'}
                  </Link>

                  {/* Author */}
                  <span className="text-xs text-gray-400 shrink-0 w-20 truncate text-right hidden sm:block">
                    {note.author || '—'}
                  </span>

                  {/* Keyword — always rendered for header alignment */}
                  <span className="text-xs text-red-400 shrink-0 w-20 truncate hidden md:block">
                    {note.keyword || ''}
                  </span>

                  {/* Likes */}
                  <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                    ❤️ {note.likes.toLocaleString()}
                  </span>

                  {/* Collects */}
                  <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                    ⭐ {note.collects.toLocaleString()}
                  </span>

                  {/* Date */}
                  <span className="text-xs text-gray-400 shrink-0 w-14 text-right">
                    {note.publish_date || '—'}
                  </span>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDeleteOne(note.id, e)}
                    disabled={busy}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded
                               text-gray-300 hover:text-red-500 transition-colors
                               opacity-0 group-hover:opacity-100 disabled:opacity-30"
                    title="删除笔记"
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-1.5 mt-6">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => updateFilter(keyword, sort, i * PAGE_SIZE)}
                  className={`px-3 py-1 rounded text-sm border transition-colors ${
                    currentPage === i + 1
                      ? 'bg-red-500 text-white border-red-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
