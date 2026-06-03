'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchTasks, deleteTask, deleteTasks, DATE_FILTER_LABEL, type Task } from '@/lib/api';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  running: { label: '采集中', cls: 'text-blue-600 bg-blue-50' },
  done:    { label: '已完成', cls: 'text-green-700 bg-green-50' },
  stopped: { label: '已停止', cls: 'text-gray-500 bg-gray-100' },
  failed:  { label: '失败',   cls: 'text-red-500 bg-red-50' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

export function SchemeList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const data = await fetchTasks();
      setTasks(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id: number, e: React.MouseEvent) {
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
      prev.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id))
    );
  }

  function selectEmpty() {
    const emptyIds = tasks.filter(t => t.done === 0).map(t => t.id);
    setSelected(new Set(emptyIds));
  }

  async function handleDeleteSelected() {
    if (!confirm(`确定删除选中的 ${selected.size} 个方案及其所有笔记数据？`)) return;
    setBusy(true);
    try {
      await deleteTasks(Array.from(selected));
      setSelected(new Set());
      await load();
    } catch {
      alert('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(id: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('确定删除该方案及其所有笔记数据？')) return;
    setBusy(true);
    try {
      await deleteTask(id);
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      await load();
    } catch {
      alert('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">加载中...</div>;

  if (error) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="mb-1">无法连接到后端</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const emptyCount = tasks.filter(t => t.done === 0).length;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {tasks.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
            />
          )}
          <span className="text-sm text-gray-500">共 {tasks.length} 个方案</span>
          {emptyCount > 0 && (
            <button
              onClick={selectEmpty}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              选中空方案 ({emptyCount})
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <button
            onClick={handleDeleteSelected}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs
                       text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
          >
            <TrashIcon /> 删除选中 ({selected.size})
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-1">暂无采集方案</p>
          <p className="text-sm">使用 Chrome 插件或 Python 爬虫开始采集</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {/* Header row */}
          <div className="flex items-center gap-3 px-4 py-2 text-xs text-gray-400 select-none">
            <span className="shrink-0 w-4" />
            <span className="flex-1 min-w-0">关键词</span>
            <span className="shrink-0 w-14">状态</span>
            <span className="shrink-0 w-14">日期筛选</span>
            <span className="shrink-0 w-12 text-right">笔记数</span>
            <span className="shrink-0 w-24 text-right">时间</span>
            <span className="shrink-0 w-6" />
          </div>

          {tasks.map((task) => {
            const status = STATUS_MAP[task.status] ?? { label: task.status, cls: 'text-gray-500 bg-gray-100' };
            const keywords = task.keywordList ?? [];
            const period = task.date_filter > 0 ? (DATE_FILTER_LABEL[task.date_filter] ?? '') : '';
            const isSelected = selected.has(task.id);

            return (
              <a
                key={task.id}
                href={`/?task_id=${task.id}`}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group
                  ${isSelected ? 'bg-red-50' : ''}`}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => toggleSelect(task.id, e)}
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

                {/* Keywords */}
                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {keywords.length > 0 ? keywords.map(kw => (
                    <span key={kw} className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600">
                      {kw}
                    </span>
                  )) : (
                    <span className="text-xs text-gray-400">无关键词</span>
                  )}
                </div>

                {/* Status */}
                <span className={`text-xs px-2 py-0.5 rounded shrink-0 w-14 text-center ${status.cls}`}>
                  {status.label}
                </span>

                {/* Date filter — always rendered for alignment */}
                <span className="text-xs text-orange-500 shrink-0 w-14">
                  {period}
                </span>

                {/* Note count */}
                <span className="text-xs text-gray-500 shrink-0 w-12 text-right">
                  {task.done} 篇
                </span>

                {/* Timestamp */}
                <span className="text-xs text-gray-400 shrink-0 w-24 text-right">
                  {fmt(task.created_at)}
                </span>

                {/* Delete */}
                <button
                  onClick={(e) => handleDeleteOne(task.id, e)}
                  disabled={busy}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded
                             text-gray-300 hover:text-red-500 transition-colors
                             opacity-0 group-hover:opacity-100 disabled:opacity-30"
                  title="删除方案"
                >
                  <TrashIcon />
                </button>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
