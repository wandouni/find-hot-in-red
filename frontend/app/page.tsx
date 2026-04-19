import { Suspense } from 'react';
import { SchemeList } from './components/SchemeList';
import { NotesDashboard } from './components/NotesDashboard';

interface SearchParams {
  task_id?: string;
  keyword?: string;
  sort?: string;
  offset?: string;
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  if (searchParams.task_id) {
    const taskId = parseInt(searchParams.task_id);
    return (
      <Suspense fallback={<div className="text-center py-16 text-gray-400">加载中...</div>}>
        <NotesDashboard
          taskId={taskId}
          initialKeyword={searchParams.keyword || ''}
          initialSort={searchParams.sort || 'date'}
          initialOffset={parseInt(searchParams.offset || '0')}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-400">加载中...</div>}>
      <SchemeList />
    </Suspense>
  );
}
