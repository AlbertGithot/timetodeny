'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ChatHistorySidebar from './ChatHistorySidebar';
import { getJson } from '@/lib/api';

const ASCII_LOGO_FULL = `
 ████████╗██╗███╗   ███╗███████╗    ████████╗ ██████╗     ██████╗ ███████╗███╗   ██╗██╗   ██╗
    ██╔══╝██║████╗ ████║██╔════╝       ██╔══╝██╔═══██╗    ██╔══██╗██╔════╝████╗  ██║╚██╗ ██╔╝
    ██║   ██║██╔████╔██║█████╗         ██║   ██║   ██║    ██║  ██║█████╗  ██╔██╗ ██║ ╚████╔╝ 
    ██║   ██║██║╚██╔╝██║██╔══╝         ██║   ██║   ██║    ██║  ██║██╔══╝  ██║╚██╗██║  ╚██╔╝  
    ██║   ██║██║ ╚═╝ ██║███████╗       ██║   ╚██████╔╝    ██████╔╝███████╗██║ ╚████║   ██║   
    ╚═╝   ╚═╝╚═╝     ╚═╝╚══════╝       ╚═╝    ╚═════╝     ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝  `;

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

export default function WelcomeClient() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoGlitch, setLogoGlitch] = useState(false);
  const [recentChats, setRecentChats] = useState<ChatEntry[]>([]);
  const [readyModel, setReadyModel] = useState('deepseek-r1:14b ready');

  useEffect(() => {
    const glitchInterval = setInterval(() => {
      setLogoGlitch(true);
      setTimeout(() => setLogoGlitch(false), 300);
    }, 8000);
    return () => clearInterval(glitchInterval);
  }, []);

  useEffect(() => {
    getJson<ChatsResponse>('/chats')
      .then(payload => setRecentChats(payload.chats.slice(0, 8)))
      .catch(() => undefined);
    getJson<{ ok: boolean; models: Array<{ name: string; selected: boolean; status: string }> }>('/models')
      .then(payload => {
        const selected = payload.models.find(model => model.selected) || payload.models[0];
        if (selected) setReadyModel(`${selected.name} ${selected.status}`);
      })
      .catch(() => undefined);
  }, []);

  const handleStart = () => {
    router?.push('/chat-interface?mode=instant');
  };

  return (
    <div className="min-h-screen bg-ttd-bg flex flex-col overflow-hidden relative">
      {/* Scanline effect */}
      <div className="pointer-events-none fixed inset-0 z-50" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)'
      }} />
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ttd-border bg-ttd-surface/50 backdrop-blur-sm sticky top-0 z-40">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 flex flex-col justify-center gap-1.5 items-center rounded hover:bg-ttd-elevated transition-colors group"
          aria-label="Open chat history"
        >
          <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
          <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
          <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
        </button>
        <span className="text-ttd-muted text-xs font-mono">TTD</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-green" />
            <span className="text-xs text-ttd-muted">{readyModel}</span>
          </div>
          <button
            onClick={() => router?.push('/admin-panel')}
            className="ttd-btn ttd-btn-ghost text-xs px-3 py-1"
          >
            [ADMIN]
          </button>
        </div>
      </div>
      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 relative">

        {/* ASCII Logo */}
        <div className={`mb-12 overflow-x-auto w-full flex justify-center ${logoGlitch ? 'animate-glitch' : ''}`}>
          <pre className="ascii-text text-ttd-green text-[7px] sm:text-[8px] lg:text-[9px] leading-tight select-none"
            style={{ textShadow: '0 0 20px rgba(0,255,136,0.4)' }}>
            {ASCII_LOGO_FULL}
          </pre>
        </div>

        {/* Start button */}
        <button
          onClick={handleStart}
          className="ttd-btn ttd-btn-cyan text-sm px-10 py-3 glow-green"
        >
          {'> START NEW SESSION'}
        </button>
      </div>
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="sidebar-overlay flex-1" onClick={() => setSidebarOpen(false)} />
          <ChatHistorySidebar chats={recentChats} onClose={() => setSidebarOpen(false)} />
        </div>
      )}
    </div>
  );
}
