import { fetchTasks } from '@/lib/api';
import type { Task } from '@/lib/api';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  running: { label: '采集中', cls: 'bg-blue-100 text-blue-700' },
  done:    { label: '已完成', cls: 'bg-green-100 text-green-700' },
  stopped: { label: '已停止', cls: 'bg-gray-100 text-gray-500' },
  failed:  { label: '失败',   cls: 'bg-red-100 text-red-600' },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function TaskCard({ task, index }: { task: Task; index: number }) {
  const status = STATUS_MAP[task.status] ?? { label: task.status, cls: 'bg-gray-100 text-gray-500' };
  const keywords = task.keywordList ?? [];
  const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm font-mono">#{task.id}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
            {status.label}
          </span>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{fmt(task.created_at)}</span>
      </div>

      {/* Keywords */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {keywords.length > 0 ? keywords.map(kw => (
          <a
            key={kw}
            href={`/?keyword=${encodeURIComponent(kw)}`}
            className="inline-block text-xs px-2.5 py-1 rounded-full
                       bg-red-50 text-red-600 border border-red-100
                       hover:bg-red-100 transition-colors"
          >
            {kw}
          </a>
        )) : (
          <span className="text-xs text-gray-400">无关键词记录</span>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-500">
          <span>采集进度</span>
          <span className="font-medium text-gray-700">{task.done} / {task.total} 篇</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${
              task.status === 'done' ? 'bg-green-500' :
              task.status === 'running' ? 'bg-blue-500' : 'bg-gray-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      {keywords.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2 flex-wrap">
          {keywords.map(kw => (
            <a
              key={kw}
              href={`/?keyword=${encodeURIComponent(kw)}`}
              className="text-xs text-gray-500 hover:text-red-500 transition-colors"
            >
              查看「{kw}」笔记 →
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function TasksPage() {
  let tasks: Task[] = [];
  let error = false;

  try {
    tasks = await fetchTasks();
  } catch {
    error = true;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-gray-700">
          采集任务
          <span className="ml-2 text-sm text-gray-400 font-normal">共 {tasks.length} 次</span>
        </h1>
        <a
          href="/"
          className="text-sm text-gray-400 hover:text-red-500 transition-colors"
        >
          ← 数据看板
        </a>
      </div>

      {error ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">无法连接到后端</p>
          <p className="text-sm">请确认已运行 ./start.sh</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">暂无采集任务</p>
          <p className="text-sm">使用 Chrome 插件开始采集后，任务记录将显示在这里</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task, i) => (
            <TaskCard key={task.id} task={task} index={i} />
          ))}
        </div>
      )}
    </>
  );
}
