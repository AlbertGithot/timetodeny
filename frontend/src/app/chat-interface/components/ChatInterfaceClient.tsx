'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import ChatSidebar from './ChatSidebar';
import MessageThread from './MessageThread';
import ChatInputBar from './ChatInputBar';
import ChatHeader from './ChatHeader';
import { getJson, streamChat } from '@/lib/api';

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
        setMode(payload.chat.mode || initialMode);
        setActiveModel(payload.chat.model || 'local-assistant');
      })
      .catch((error: Error) => toast.error(error.message));

    return () => { cancelled = true; };
  }, [searchParams, initialMode]);

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
      thinking: thinkingText,
      thinkingVisible: mode === 'expert',
    };

    setMessages(prev => [...prev, assistantMsg]);

    let accumulated = '';
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
          },
          onThinking: (thinking) => {
            setMessages(prev => prev.map(m =>
              m.id === streamingId ? { ...m, thinking, thinkingVisible: true } : m
            ));
          },
          onToken: (token) => {
            accumulated += token;
            setMessages(prev => prev.map(m =>
              m.id === streamingId
                ? { ...m, content: accumulated, thinkingVisible: false }
                : m
            ));
          },
          onDone: (data) => {
            const done = data as StreamDonePayload;
            if (done.chat?.id) setChatId(done.chat.id);
            if (done.message) {
              setMessages(prev => prev.map(m =>
                m.id === streamingId ? { ...done.message!, streaming: false } : m
              ));
              const total = done.message.totalTokens || 0;
              const speed = done.message.tokensPerSec ? `${done.message.tokensPerSec} tok/s` : 'stream complete';
              toast.success(`Response complete · ${total} tokens · ${speed}`);
            }
          },
          onError: (error) => {
            throw new Error(error);
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      setMessages(prev => prev.map(m =>
        m.id === streamingId
          ? {
              ...m,
              content: `Backend error: ${message}`,
              streaming: false,
              testResult: { passed: false, output: message },
            }
          : m
      ));
      toast.error(message);
    } finally {
      setIsStreaming(false);
    }
  }, [activeModel, chatId, mode]);

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
            <ChatSidebar onClose={() => setSidebarOpen(false)} />
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
            isStreaming={isStreaming}
            mode={mode}
            pendingAttachments={pendingAttachments}
            onAttachmentsChange={setPendingAttachments}
          />
        </div>
      </div>
    </div>
  );
}
