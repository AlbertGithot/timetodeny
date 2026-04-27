'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, ArrowRight } from 'lucide-react';
import { getJson } from '@/lib/api';
import {
  clearTrackedGeneration,
  getTrackedGeneration,
  onTrackedGenerationChange,
  setTrackedGeneration,
  type TrackedGeneration,
} from '@/lib/generation-watch';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  streaming?: boolean;
  generation?: {
    status: string;
    phase: string;
    activity: string;
    progress: number;
  };
}

interface ChatDetailResponse {
  ok: boolean;
  chat: {
    id: string;
    messages: Message[];
  };
}

function latestStreamingAssistant(messages: Message[]): Message | null {
  return [...messages].reverse().find(message =>
    message.role === 'assistant'
    && (message.streaming || message.generation?.status === 'streaming')
  ) || null;
}

export default function GlobalGenerationOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedGeneration | null>(null);

  useEffect(() => {
    setTracked(getTrackedGeneration());
    return onTrackedGenerationChange(setTracked);
  }, []);

  useEffect(() => {
    if (!tracked?.chatId) return;

    let cancelled = false;
    const refresh = () => {
      getJson<ChatDetailResponse>(`/chats/${tracked.chatId}`)
        .then((payload) => {
          if (cancelled) return;
          const streaming = latestStreamingAssistant(payload.chat.messages || []);
          if (!streaming) {
            clearTrackedGeneration(payload.chat.id);
            setTracked(null);
            return;
          }
          const generation = streaming.generation;
          const next = setTrackedGeneration({
            chatId: payload.chat.id,
            messageId: streaming.id,
            status: generation?.status || 'streaming',
            phase: generation?.phase || 'working',
            activity: generation?.activity || 'Модель работает над вашим запросом...',
            progress: generation?.progress || tracked.progress || 1,
          });
          if (next) setTracked(next);
        })
        .catch((error: Error) => {
          if (cancelled) return;
          if (error.message.includes('404') || error.message.toLowerCase().includes('not found')) {
            clearTrackedGeneration(tracked.chatId);
            setTracked(null);
          }
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 1400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tracked?.chatId, tracked?.messageId]);

  if (!tracked || tracked.status !== 'streaming' || pathname?.startsWith('/chat-interface')) {
    return null;
  }

  const progress = Math.max(1, Math.min(99, Number(tracked.progress || 1)));

  return (
    <div className="global-generation-overlay">
      <button
        type="button"
        className="global-generation-card"
        onClick={() => router.push(`/chat-interface?chat=${encodeURIComponent(tracked.chatId)}`)}
        title="Вернуться к активному чату"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Activity size={14} className="text-ttd-green generation-activity-icon flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="generation-activity-title">Модель работает над вашим запросом</div>
              <div className="generation-activity-text truncate">{tracked.activity || 'Пишу в чат...'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-ttd-green font-mono">{progress}%</span>
            <ArrowRight size={12} className="text-ttd-muted" />
          </div>
        </div>
        <div className="generation-progress mt-3">
          <div className="generation-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </button>
    </div>
  );
}
