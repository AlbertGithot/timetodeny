'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, MessageSquare, Zap, Brain, Image, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { deleteJson, getJson } from '@/lib/api';

interface ChatEntry {
  id: string;
  title: string;
  model: string;
  mode: string;
  ts: string;
  msgs: number;
}

interface ChatsResponse {
  ok: boolean;
  chats: ChatEntry[];
}

interface Props {
  onClose: () => void;
  activeChatId?: string | null;
  onChatDeleted?: (id: string) => void;
}

export default function ChatSidebar({ onClose, activeChatId, onChatDeleted }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [chats, setChats] = useState<ChatEntry[]>([]);

  useEffect(() => {
    getJson<ChatsResponse>('/chats')
      .then(payload => setChats(payload.chats))
      .catch((error: Error) => toast.error(error.message));
  }, []);

  const filtered = chats.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.model.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteJson(`/chats/${id}`);
      setChats(prev => prev.filter(c => c.id !== id));
      onChatDeleted?.(id);
      toast.success('Conversation deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const handleSelect = (id: string, mode: string) => {
    router.push(`/chat-interface?chat=${id}&mode=${mode}`);
    onClose();
  };

  return (
    <div className="w-72 bg-ttd-surface border-r border-ttd-border h-full flex flex-col animate-slide-left overflow-hidden z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ttd-border flex-shrink-0">
        <div>
          <div className="text-xs font-bold text-ttd-text tracking-wider">HISTORY</div>
          <div className="text-[10px] text-ttd-muted">MySQL · {chats.length} stored</div>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-ttd-elevated transition-colors">
          <X size={14} className="text-ttd-muted" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-ttd-border flex-shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ttd-dim" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter conversations..."
            className="ttd-input text-xs py-1.5 pl-7"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-ttd-muted">
            <MessageSquare size={16} className="mb-2 opacity-30" />
            <span className="text-xs">No matches</span>
          </div>
        ) : (
          filtered.map((chat) => (
            <div
              key={chat.id}
              onClick={() => handleSelect(chat.id, chat.mode)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(chat.id, chat.mode); }}
              className="w-full text-left px-3 py-2.5 hover:bg-ttd-elevated transition-colors border-b border-ttd-border/40 group relative cursor-pointer"
            >
              <div className="flex items-start gap-2 pr-6">
                <div className="mt-0.5 flex-shrink-0">
                  {chat.model === 'flux-dev' ? (
                    <Image size={11} className="text-ttd-purple" />
                  ) : chat.mode === 'expert' ? (
                    <Brain size={11} className="text-ttd-green" />
                  ) : (
                    <Zap size={11} className="text-ttd-cyan" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ttd-text truncate group-hover:text-ttd-green transition-colors">
                    {chat.title}
                    {chat.id === activeChatId && <span className="ml-1 text-[9px] text-ttd-green">ACTIVE</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] text-ttd-muted truncate max-w-[100px]">{chat.model}</span>
                    <span className="text-[9px] text-ttd-dim">·</span>
                    <span className="text-[9px] text-ttd-dim">{chat.msgs}msg</span>
                    <span className="text-[9px] text-ttd-dim">·</span>
                    <span className="text-[9px] text-ttd-dim">{chat.ts}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(chat.id, e)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-ttd-red transition-all rounded"
              >
                <Trash2 size={11} className="text-ttd-muted hover:text-ttd-red" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* New chat */}
      <div className="px-3 py-3 border-t border-ttd-border flex-shrink-0">
        <button
          onClick={() => { router.push('/chat-interface'); onClose(); }}
          className="ttd-btn ttd-btn-green w-full text-xs py-2"
        >
          + NEW CONVERSATION
        </button>
      </div>
    </div>
  );
}
