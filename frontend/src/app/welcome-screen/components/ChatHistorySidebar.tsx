'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { X, MessageSquare, Zap, Brain, Image } from 'lucide-react';

interface ChatEntry {
  id: string;
  title: string;
  model: string;
  mode: string;
  ts: string;
  msgs: number;
}

interface Props {
  chats: ChatEntry[];
  onClose: () => void;
}

export default function ChatHistorySidebar({ chats, onClose }: Props) {
  const router = useRouter();

  const handleSelect = (id: string, mode: string) => {
    router.push(`/chat-interface?chat=${id}&mode=${mode}`);
  };

  return (
    <div className="w-80 bg-ttd-surface border-l border-ttd-border h-full flex flex-col animate-slide-right overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ttd-border">
        <div>
          <div className="text-xs font-bold text-ttd-text tracking-wider">CHAT HISTORY</div>
          <div className="text-[10px] text-ttd-muted">MySQL · {chats.length} conversations</div>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-ttd-elevated transition-colors">
          <X size={14} className="text-ttd-muted" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-ttd-border">
        <input
          type="text"
          placeholder="search conversations..."
          className="ttd-input text-xs py-1.5"
        />
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-ttd-muted">
            <MessageSquare size={20} className="mb-2 opacity-40" />
            <span className="text-xs">No conversations yet</span>
          </div>
        ) : (
          <div className="py-1">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handleSelect(chat.id, chat.mode)}
                className="w-full text-left px-3 py-3 hover:bg-ttd-elevated transition-colors border-b border-ttd-border/50 group"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex-shrink-0">
                    {chat.model === 'flux-dev' ? (
                      <Image size={12} className="text-ttd-purple" />
                    ) : chat.mode === 'expert' ? (
                      <Brain size={12} className="text-ttd-green" />
                    ) : (
                      <Zap size={12} className="text-ttd-cyan" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-ttd-text truncate group-hover:text-ttd-green transition-colors">
                      {chat.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-ttd-muted truncate">{chat.model}</span>
                      <span className="text-[10px] text-ttd-dim">·</span>
                      <span className="text-[10px] text-ttd-dim">{chat.msgs} msgs</span>
                    </div>
                    <div className="text-[10px] text-ttd-dim mt-0.5">{chat.ts}</div>
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`text-[9px] px-1 py-0.5 rounded-sm border ${
                      chat.mode === 'expert' ?'text-ttd-green border-ttd-green/30' :'text-ttd-cyan border-ttd-cyan/30'
                    }`}>
                      {chat.mode.toUpperCase()}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-ttd-border">
        <button className="ttd-btn ttd-btn-ghost w-full text-xs py-2">
          + NEW CONVERSATION
        </button>
      </div>
    </div>
  );
}