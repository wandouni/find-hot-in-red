'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  fetchNotes, fetchTask, deleteNote, deleteNotes,
  DATE_FILTER_LABEL, type Task, type Note,
} from '@/lib/api';
import { ExportButton } from './ExportButton';

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: 'date',    label: '最新' },
  { value: 'likes',   label: '点赞最多' },
  { value: 'collects', label: '收藏最多' },
];

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    if (!confirm(`确定删除选中的 ${selected.size} 条笔记？此操作不可撤销。`)) return;
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
        <p className="text-lg mb-2">无法加载方案数据</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a href="/" className="text-sm text-gray-400 hover:text-red-500 transition-colors">
              ← 返回方案列表
            </a>
          </div>
          <h1 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
            方案 #{taskId}
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 font-normal">
              {period}
            </span>
            <span className="text-sm text-gray-400 font-normal">共 {total} 篇</span>
          </h1>
          <div className="flex flex-wrap gap-1 mt-1">
            {keywords.map(kw => (
              <span key={kw} className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                {kw}
              </span>
            ))}
          </div>
        </div>
        <ExportButton
          taskId={taskId}
          taskMeta={{ keywords, period, date: task?.created_at ?? '' }}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {notes.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-gray-300 text-red-500 cursor-pointer"
            title={allSelected ? '取消全选' : '全选本页'}
          />
        )}

        {keywords.length > 1 && (
          <select
            value={keyword}
            onChange={(e) => updateFilter(e.target.value, sort, 0)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">全部关键词</option>
            {keywords.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}

        <div className="flex gap-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateFilter(keyword, opt.value, 0)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                sort === opt.value
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <button
            onClick={handleDeleteSelected}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm
                       bg-red-50 text-red-600 border border-red-200
                       hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
          >
            <TrashIcon />
            删除选中 ({selected.size})
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">加载中...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">该方案暂无数据</p>
          <p className="text-sm">采集完成后笔记将显示在这里</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notes.map((note) => {
              const isSelected = selected.has(note.id);
              return (
                <div key={note.id} className="relative group">
                  {/* Checkbox */}
                  <button
                    onClick={(e) => toggleSelect(note.id, e)}
                    className={`absolute top-3 left-3 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all
                      ${isSelected
                        ? 'bg-red-500 border-red-500'
                        : 'bg-white border-gray-300 opacity-0 group-hover:opacity-100'
                      }`}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDeleteOne(note.id, e)}
                    disabled={busy}
                    className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center
                               text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all
                               opacity-0 group-hover:opacity-100 disabled:opacity-30"
                    title="删除笔记"
                  >
                    <TrashIcon />
                  </button>

                  {/* Note card */}
                  <Link href={`/notes/${note.id}`}>
                    <div className={`rounded-xl border p-4 transition-all cursor-pointer
                      ${isSelected
                        ? 'border-red-300 bg-red-50 shadow-md'
                        : 'border-gray-200 bg-white hover:shadow-md hover:border-red-200'
                      }`}
                    >
                      <h3 className="font-semibold text-gray-900 line-clamp-2 mb-2 text-sm leading-snug pl-5 pr-6">
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
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => updateFilter(keyword, sort, i * PAGE_SIZE)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
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
