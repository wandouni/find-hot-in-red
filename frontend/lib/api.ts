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

export interface Task {
  id: number;
  keywords: string | null;
  status: string;
  total: number;
  done: number;
  created_at: string;
}

export async function fetchNotes(params: {
  keyword?: string;
  sort?: 'likes' | 'collects' | 'date';
  limit?: number;
  offset?: number;
}): Promise<NotesResponse> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.sort) query.set('sort', params.sort);
  if (params.limit != null) query.set('limit', String(params.limit));
  if (params.offset != null) query.set('offset', String(params.offset));

  const res = await fetch(`${API_BASE}/api/notes?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json();
}

export async function fetchNote(id: string): Promise<NoteDetail> {
  const res = await fetch(`${API_BASE}/api/notes/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Note not found: ${res.status}`);
  return res.json();
}
