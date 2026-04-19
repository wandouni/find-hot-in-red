'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchTasks, deleteTask, deleteTasks, DATE_FILTER_LABEL, type Task } from '@/lib/api';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  running: { label: '采集中', cls: 'bg-blue-100 text-blue-700' },
  done:    { label: '已完成', cls: 'bg-green-100 text-green-700' },
  stopped: { label: '已停止', cls: 'bg-gray-100 text-gray-500' },
  failed:  { label: '失败',   cls: 'bg-red-100 text-red-600' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

  async function handleDeleteSelected() {
    if (!confirm(`确定删除选中的 ${selected.size} 个方案及其所有笔记数据？此操作不可撤销。`)) return;
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
    if (!confirm('确定删除该方案及其所有笔记数据？此操作不可撤销。')) return;
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

  if (loading) {
    return <div className="text-center py-16 text-gray-400">加载中...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg mb-2">无法连接到后端</p>
        <p className="text-sm">请确认已运行 ./start.sh</p>
      </div>
    );
  }

  const allSelected = tasks.length > 0 && selected.size === tasks.length;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {tasks.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-gray-300 text-red-500 cursor-pointer"
              title={allSelected ? '取消全选' : '全选'}
            />
          )}
          <h1 className="text-lg font-semibold text-gray-700">
            选择学习方案
            <span className="ml-2 text-sm text-gray-400 font-normal">共 {tasks.length} 个方案</span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                         bg-red-50 text-red-600 border border-red-200
                         hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
            >
              <TrashIcon />
              删除选中 ({selected.size})
            </button>
          )}
          <a href="/tasks" className="text-sm text-gray-400 hover:text-red-500 transition-colors">
            采集任务管理 →
          </a>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">暂无采集方案</p>
          <p className="text-sm">使用 Chrome 插件开始采集，每次采集即创建一个学习方案</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task) => {
            const status = STATUS_MAP[task.status] ?? { label: task.status, cls: 'bg-gray-100 text-gray-500' };
            const keywords = task.keywordList ?? [];
            const period = DATE_FILTER_LABEL[task.date_filter] ?? '不限';
            const isSelected = selected.has(task.id);

            return (
              <div key={task.id} className="relative group">
                {/* Checkbox overlay */}
                <button
                  onClick={(e) => toggleSelect(task.id, e)}
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
                  onClick={(e) => handleDeleteOne(task.id, e)}
                  disabled={busy}
                  className="absolute top-3 right-3 z-10 w-7 h-7 rounded-lg flex items-center justify-center
                             text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all
                             opacity-0 group-hover:opacity-100 disabled:opacity-30"
                  title="删除方案"
                >
                  <TrashIcon />
                </button>

                {/* Card */}
                <a
                  href={`/?task_id=${task.id}`}
                  className={`block rounded-xl border shadow-sm p-5 transition-all
                    ${isSelected
                      ? 'border-red-300 bg-red-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-red-300 hover:shadow-md'
                    }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3 pl-5">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm font-mono">#{task.id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100">
                        {period}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 pr-6">{fmt(task.created_at)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {keywords.length > 0 ? keywords.map(kw => (
                      <span key={kw} className="inline-block text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-100">
                        {kw}
                      </span>
                    )) : (
                      <span className="text-xs text-gray-400">无关键词记录</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">共 <strong className="text-gray-700">{task.done}</strong> 篇笔记</span>
                    <span className="text-red-400 text-xs group-hover:text-red-600 transition-colors">
                      查看方案 →
                    </span>
                  </div>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
