const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Comment {
  id: string;
  note_id: string;
  content: string | null;
  likes: number;
  rank: number | null;
}

export interface Note {
  id: string;
  task_id: number | null;
  keyword: string | null;
  title: string | null;
  author: string | null;
  author_id: string | null;
  likes: number;
  collects: number;
  publish_date: string | null;
  url: string | null;
  source: string;
  crawl_time: string;
}

export interface NoteDetail extends Note {
  content: string | null;
  comments: Comment[];
}

export interface NotesResponse {
  total: number;
  items: Note[];
}

export const DATE_FILTER_LABEL: Record<number, string> = {
  0: '不限',
  1: '1天内',
  2: '2天内',
  7: '1周内',
};

export interface Task {
  id: number;
  keywords: string | null;      // JSON array string e.g. '["职场","AI"]'
  status: string;               // running | done | stopped | failed
  total: number;
  done: number;
  date_filter: number;
  created_at: string;
  keywordList?: string[];       // parsed client-side
}

export async function fetchNotes(params: {
  task_id?: number;
  keyword?: string;
  sort?: 'likes' | 'collects' | 'date';
  limit?: number;
  offset?: number;
}): Promise<NotesResponse> {
  const query = new URLSearchParams();
  if (params.task_id != null) query.set('task_id', String(params.task_id));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.sort) query.set('sort', params.sort);
  if (params.limit != null) query.set('limit', String(params.limit));
  if (params.offset != null) query.set('offset', String(params.offset));

  const res = await fetch(`${API_BASE}/api/notes?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json();
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${API_BASE}/api/tasks`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  const tasks: Task[] = await res.json();
  return tasks.map(t => ({
    ...t,
    keywordList: t.keywords ? JSON.parse(t.keywords) : [],
  }));
}

export async function fetchTask(id: number): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Task not found: ${res.status}`);
  const t: Task = await res.json();
  return { ...t, keywordList: t.keywords ? JSON.parse(t.keywords) : [] };
}

export async function fetchNote(id: string): Promise<NoteDetail> {
  const res = await fetch(`${API_BASE}/api/notes/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Note not found: ${res.status}`);
  return res.json();
}

export async function deleteTask(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function deleteTasks(ids: number[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ids),
  });
  if (!res.ok) throw new Error(`Bulk delete failed: ${res.status}`);
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function deleteNotes(ids: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ids),
  });
  if (!res.ok) throw new Error(`Bulk delete failed: ${res.status}`);
}
