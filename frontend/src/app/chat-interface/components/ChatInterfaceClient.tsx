'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import ChatSidebar from './ChatSidebar';
import MessageThread from './MessageThread';
import ChatInputBar from './ChatInputBar';
import ChatHeader from './ChatHeader';
import WorkspacePanel from './WorkspacePanel';
import { getJson, postJson, streamChat } from '@/lib/api';

export type Mode = 'instant' | 'expert';

export interface Attachment {
  id: string;
  name: string;
  type: 'file' | 'image';
  size: string;
  content?: string;
}

export interface GeneratedFile {
  id: string;
  name: string;
  language?: string;
  content: string;
  type: 'code' | 'text' | 'image_url';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
  streaming?: boolean;
  generation?: {
    status: string;
    phase: string;
    activity: string;
    progress: number;
  };
  thinkingVisible?: boolean;
  thinking?: string;
  attachments?: Attachment[];
  generatedFiles?: GeneratedFile[];
  tokensPerSec?: number;
  totalTokens?: number;
  testResult?: { passed: boolean; output: string };
}

interface ChatDetailResponse {
  ok: boolean;
  chat: {
    id: string;
    mode: Mode;
    model: string;
    messages: Message[];
  };
}

interface StreamDonePayload {
  message?: Message;
  chat?: {
    id: string;
  };
}

function isModelLoadingError(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('503')
    || text.includes('service unavailable')
    || text.includes('not ready')
    || text.includes('still loading')
    || text.includes('model loading');
}

export default function ChatInterfaceClient() {
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as Mode) || 'instant';

  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeModel, setActiveModel] = useState('local-assistant');
  const [inputValue, setInputValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [chatId, setChatId] = useState<string | null>(searchParams.get('chat'));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceRefreshKey = useMemo(
    () => messages.map(m => `${m.id}:${m.streaming ? '1' : '0'}:${m.generatedFiles?.length || 0}`).join('|'),
    [messages]
  );
  const hasStreamingMessage = useMemo(() => messages.some(m => m.streaming), [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const id = searchParams.get('chat');
    if (!id) return;

    let cancelled = false;
    getJson<ChatDetailResponse>(`/chats/${id}`)
      .then((payload) => {
        if (cancelled) return;
        setChatId(payload.chat.id);
        setMessages(payload.chat.messages || []);
        setIsStreaming((payload.chat.messages || []).some(m => m.streaming));
        setMode(payload.chat.mode || initialMode);
        setActiveModel(payload.chat.model || 'local-assistant');
      })
      .catch((error: Error) => toast.error(error.message));

    return () => { cancelled = true; };
  }, [searchParams, initialMode]);

  useEffect(() => {
    if (!chatId || !hasStreamingMessage) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      getJson<ChatDetailResponse>(`/chats/${chatId}`)
        .then((payload) => {
          if (cancelled) return;
          const nextMessages = payload.chat.messages || [];
          setMessages(nextMessages);
          setIsStreaming(nextMessages.some(m => m.streaming));
        })
        .catch(() => undefined);
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatId, hasStreamingMessage]);

  const handleSend = useCallback(async (text: string, attachments: Attachment[]) => {
    if (!text.trim() && attachments.length === 0) return;

    const now = new Date().toTimeString().slice(0, 8);
    const userMsg: Message = {
      id: `msg-u-${Date.now()}`,
      role: 'user',
      content: text,
      ts: now,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    const streamingId = `msg-a-${Date.now()}`;
    const thinkingText = mode === 'expert'
      ? 'Waiting for backend reasoning stream...'
      : undefined;

    const assistantMsg: Message = {
      id: streamingId,
      role: 'assistant',
      content: '',
      ts: now,
      streaming: true,
      generation: {
        status: 'streaming',
        phase: 'starting',
        activity: 'Модель работает над вашим запросом...',
        progress: 1,
      },
      thinking: thinkingText,
      thinkingVisible: mode === 'expert',
    };

    setMessages(prev => [...prev, assistantMsg]);

    let accumulated = '';
    let assistantMessageId = streamingId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        {
          chatId,
          message: text,
          mode,
          model: activeModel,
          attachments,
        },
        {
          onMeta: (data) => {
            if (typeof data.chatId === 'string') setChatId(data.chatId);
            if (typeof data.assistantMessageId === 'string') {
              assistantMessageId = data.assistantMessageId;
              setMessages(prev => prev.map(m =>
                m.id === streamingId ? { ...m, id: assistantMessageId } : m
              ));
            }
          },
          onThinking: (thinking) => {
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId ? { ...m, thinking, thinkingVisible: true } : m
            ));
          },
          onStatus: (status) => {
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    generation: {
                      status: String(status.status || 'streaming'),
                      phase: String(status.phase || 'working'),
                      activity: String(status.activity || 'Модель работает над вашим запросом...'),
                      progress: Number(status.progress || 0),
                    },
                  }
                : m
            ));
          },
          onToken: (token) => {
            accumulated += token;
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId
                ? { ...m, content: accumulated, thinkingVisible: false }
                : m
            ));
          },
          onDone: (data) => {
            const done = data as StreamDonePayload;
            if (done.chat?.id) setChatId(done.chat.id);
            if (done.message) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMessageId ? { ...done.message!, streaming: false } : m
              ));
              const total = done.message.totalTokens || 0;
              const speed = done.message.tokensPerSec ? `${done.message.tokensPerSec} tok/s` : 'stream complete';
              toast.success(`Response complete · ${total} tokens · ${speed}`);
            }
          },
          onError: (error) => {
            throw new Error(error);
          },
        },
        controller.signal
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMessageId
            ? { ...m, content: accumulated || 'Generation stopped.', streaming: false }
            : m
        ));
        return;
      }
      const message = error instanceof Error ? error.message : 'Stream failed';
      const modelLoading = isModelLoadingError(message);
      setMessages(prev => prev.map(m =>
        m.id === assistantMessageId
          ? {
              ...m,
              content: modelLoading
                ? 'Model loading. llama.cpp is still warming up; try again in a moment.'
                : `Backend error: ${message}`,
              streaming: false,
              testResult: modelLoading ? undefined : { passed: false, output: message },
            }
          : m
      ));
      if (modelLoading) {
        toast('Model loading. Wait a moment and retry.');
      } else {
        toast.error(message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    }
  }, [activeModel, chatId, mode]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    void postJson('/chat/stop', {}).catch(() => undefined);
    setIsStreaming(false);
    setMessages(prev => prev.map(m =>
      m.streaming ? { ...m, streaming: false, content: m.content || 'Generation stopped.' } : m
    ));
    toast('Generation stopped');
  }, []);

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    toast.success(`Mode switched to ${newMode.toUpperCase()}`);
  };

  return (
    <div className="h-screen bg-ttd-bg flex flex-col overflow-hidden">
      <ChatHeader
        mode={mode}
        onModeChange={handleModeChange}
        activeModel={activeModel}
        onModelChange={setActiveModel}
        isStreaming={isStreaming}
        onSidebarToggle={() => setSidebarOpen(true)}
        onNewChat={() => {
          setChatId(null);
          setMessages([]);
          toast('New conversation started');
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 flex">
            <ChatSidebar
              activeChatId={chatId}
              onClose={() => setSidebarOpen(false)}
              onChatDeleted={(deletedId) => {
                if (deletedId === chatId) {
                  setChatId(null);
                  setMessages([]);
                  setIsStreaming(false);
                  setSidebarOpen(false);
                  window.history.replaceState(null, '', '/chat-interface');
                }
              }}
            />
            <div className="flex-1 sidebar-overlay" onClick={() => setSidebarOpen(false)} />
          </div>
        )}

        {/* Message area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <MessageThread
            messages={messages}
            isStreaming={isStreaming}
            messagesEndRef={messagesEndRef}
          />
          <ChatInputBar
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            mode={mode}
            pendingAttachments={pendingAttachments}
            onAttachmentsChange={setPendingAttachments}
          />
        </div>
        <WorkspacePanel chatId={chatId} refreshKey={workspaceRefreshKey} />
      </div>
    </div>
  );
}
