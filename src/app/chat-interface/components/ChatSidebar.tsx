'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, MessageSquare, Zap, Brain, Image, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

const CHATS = [
  { id: 'chat-001', title: 'Rust async runtime deep dive', model: 'deepseek-r1:14b', mode: 'expert', ts: '11:22', msgs: 34 },
  { id: 'chat-002', title: 'Generate FastAPI boilerplate', model: 'qwen2.5-coder:7b', mode: 'instant', ts: '09:14', msgs: 12 },
  { id: 'chat-003', title: 'Image: cyberpunk city at dusk', model: 'flux-dev', mode: 'instant', ts: 'Yesterday', msgs: 3 },
  { id: 'chat-004', title: 'Explain transformer attention', model: 'llama3.3:70b', mode: 'expert', ts: 'Yesterday', msgs: 28 },
  { id: 'chat-005', title: 'Write unit tests for auth module', model: 'qwen2.5-coder:7b', mode: 'instant', ts: 'Yesterday', msgs: 19 },
  { id: 'chat-006', title: 'Docker compose for ML stack', model: 'deepseek-r1:14b', mode: 'expert', ts: 'Mon', msgs: 9 },
  { id: 'chat-007', title: 'Summarize arxiv: Mamba2 paper', model: 'llama3.3:70b', mode: 'instant', ts: 'Mon', msgs: 6 },
  { id: 'chat-008', title: 'CUDA kernel optimization tips', model: 'deepseek-r1:14b', mode: 'expert', ts: 'Sun', msgs: 41 },
  { id: 'chat-009', title: 'Build a Zig HTTP server', model: 'qwen2.5-coder:7b', mode: 'instant', ts: 'Sat', msgs: 22 },
  { id: 'chat-010', title: 'Diffusion model math explained', model: 'llama3.3:70b', mode: 'expert', ts: 'Fri', msgs: 15 },
];

interface Props {
  onClose: () => void;
}

export default function ChatSidebar({ onClose }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [chats, setChats] = useState(CHATS);

  const filtered = chats.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.model.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== id));
    toast.success('Conversation deleted');
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