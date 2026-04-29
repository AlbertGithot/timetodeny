export interface TrackedGeneration {
  chatId: string;
  messageId?: string;
  status: string;
  phase: string;
  activity: string;
  progress: number;
  startedAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'ttd_active_generation';
const EVENT_NAME = 'ttd:generation-updated';
const MAX_STALE_MS = 6 * 60 * 60 * 1000;

function emitTrackedGeneration(value: TrackedGeneration | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: value }));
}

function normalizeProgress(value: unknown): number {
  const progress = Number(value || 0);
  if (!Number.isFinite(progress)) return 1;
  return Math.max(1, Math.min(99, Math.round(progress)));
}

export function getTrackedGeneration(): TrackedGeneration | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as TrackedGeneration;
    if (!parsed.chatId) return null;
    if (Date.now() - Number(parsed.updatedAt || parsed.startedAt || 0) > MAX_STALE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      ...parsed,
      status: parsed.status || 'streaming',
      phase: parsed.phase || 'working',
      activity: parsed.activity || 'Модель работает над вашим запросом...',
      progress: normalizeProgress(parsed.progress),
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function setTrackedGeneration(
  update: Partial<TrackedGeneration> & { chatId: string }
): TrackedGeneration | null {
  if (typeof window === 'undefined') return null;
  const current = getTrackedGeneration();
  const now = Date.now();
  const sameChat = current?.chatId === update.chatId;
  const next: TrackedGeneration = {
    chatId: update.chatId,
    messageId: update.messageId ?? (sameChat ? current?.messageId : undefined),
    status: update.status || (sameChat ? current?.status : undefined) || 'streaming',
    phase: update.phase || (sameChat ? current?.phase : undefined) || 'working',
    activity: update.activity || (sameChat ? current?.activity : undefined) || 'Модель работает над вашим запросом...',
    progress: normalizeProgress(update.progress ?? (sameChat ? current?.progress : undefined) ?? 1),
    startedAt: sameChat ? current.startedAt : now,
    updatedAt: now,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  emitTrackedGeneration(next);
  return next;
}

export function clearTrackedGeneration(chatId?: string): void {
  if (typeof window === 'undefined') return;
  const current = getTrackedGeneration();
  if (chatId && current?.chatId && current.chatId !== chatId) return;
  window.localStorage.removeItem(STORAGE_KEY);
  emitTrackedGeneration(null);
}

export function onTrackedGenerationChange(callback: (value: TrackedGeneration | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleCustom = (event: Event) => {
    callback((event as CustomEvent<TrackedGeneration | null>).detail ?? null);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback(getTrackedGeneration());
  };

  window.addEventListener(EVENT_NAME, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}
