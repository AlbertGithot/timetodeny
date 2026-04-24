const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0']);
const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api';

function normalizeApiBase(value: string): string {
  return value.endsWith('/') && value !== '/' ? value.slice(0, -1) : value;
}

function resolveApiBase(): string {
  const normalized = normalizeApiBase(RAW_API_BASE);
  if (typeof window === 'undefined') return normalized;

  try {
    const resolved = new URL(normalized, window.location.origin);
    const siteHost = window.location.hostname;
    if (LOOPBACK_HOSTS.has(resolved.hostname) && !LOOPBACK_HOSTS.has(siteHost)) {
      return '/api';
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export const API_BASE = resolveApiBase();

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE === '/' ? normalizedPath : `${API_BASE}${normalizedPath}`;
}

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('ttd_admin_token') || '';
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('ttd_admin_token', token);
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('ttd_admin_token');
}

export function authHeaders(): HeadersInit {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `API request failed: ${response.status}`);
  }
  return payload as T;
}

export async function getJson<T>(path: string, admin = false): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: admin ? authHeaders() : undefined,
    cache: 'no-store',
  });
  return parseResponse<T>(response);
}

export async function postJson<T>(path: string, body: unknown = {}, admin = false): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(admin ? authHeaders() : {}),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(response);
}

export async function deleteJson<T>(path: string, admin = false): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'DELETE',
    headers: admin ? authHeaders() : undefined,
  });
  return parseResponse<T>(response);
}

interface StreamHandlers {
  onMeta?: (data: Record<string, unknown>) => void;
  onThinking?: (text: string) => void;
  onToken?: (text: string) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (error: string) => void;
}

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  const lines = block.split('\n');
  const eventLine = lines.find(line => line.startsWith('event:'));
  const dataLine = lines.find(line => line.startsWith('data:'));
  if (!eventLine || !dataLine) return null;
  return {
    event: eventLine.slice(6).trim(),
    data: JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>,
  };
}

export async function streamChat(payload: unknown, handlers: StreamHandlers): Promise<void> {
  const response = await fetch(apiUrl('/chat/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Chat stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      if (parsed) {
        if (parsed.event === 'meta') handlers.onMeta?.(parsed.data);
        if (parsed.event === 'thinking') handlers.onThinking?.(String(parsed.data.text || ''));
        if (parsed.event === 'token') handlers.onToken?.(String(parsed.data.text || ''));
        if (parsed.event === 'done') handlers.onDone?.(parsed.data);
        if (parsed.event === 'error') handlers.onError?.(String(parsed.data.error || 'Unknown stream error'));
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
