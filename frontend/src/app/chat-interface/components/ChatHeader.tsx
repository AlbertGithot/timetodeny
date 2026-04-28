'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Brain, ChevronDown, Plus, Shield, Activity } from 'lucide-react';
import type { Mode } from './ChatInterfaceClient';
import { getJson } from '@/lib/api';

const ASCII_TTD_COMPACT = `╔╦╗╔╦╗╔╦╗
 ║  ║  ║ 
 ╩  ╩  ╩ `;

interface AvailableModel {
  id: string;
  name: string;
  type: string;
  vram: string;
  status: string;
  selected?: boolean;
  autoSelect?: boolean;
  useForInstant?: boolean;
  useForExpert?: boolean;
}

interface ModelsResponse {
  ok: boolean;
  models: Array<{
    id: string;
    name: string;
    type: string;
    vram: string;
    status: string;
    selected: boolean;
    hidden: boolean;
    performance?: {
      autoSelect?: boolean;
      useForInstant?: boolean;
      useForExpert?: boolean;
    };
  }>;
}

interface RuntimeResponse {
  ok: boolean;
  runtime: {
    state: 'ready' | 'loading' | 'offline' | 'error';
    label: string;
    selectedModel?: string | null;
    health?: string | null;
  };
}

interface Props {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  activeModel: string;
  onModelChange: (m: string) => void;
  isStreaming: boolean;
  onSidebarToggle: () => void;
  onNewChat: () => void;
}

export default function ChatHeader({ mode, onModeChange, activeModel, onModelChange, isStreaming, onSidebarToggle, onNewChat }: Props) {
  const router = useRouter();
  const [modelDropOpen, setModelDropOpen] = useState(false);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [runtime, setRuntime] = useState<RuntimeResponse['runtime'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<ModelsResponse>('/models')
      .then((payload) => {
        if (cancelled) return;
        const visible = payload.models
          .filter(model => !model.hidden && model.status === 'ready')
          .map(model => ({
            id: model.id,
            name: model.name,
            type: model.type.toUpperCase(),
            vram: model.vram,
            status: model.status,
            selected: model.selected,
            autoSelect: model.performance?.autoSelect ?? true,
            useForInstant: model.performance?.useForInstant ?? true,
            useForExpert: model.performance?.useForExpert ?? true,
          }));
        if (visible.length > 0) {
          setModels(visible);
          const selected = visible.find(model => model.selected);
          const activeExists = visible.some(model => model.name === activeModel);
          if (selected && activeModel !== '__auto__' && (!activeExists || activeModel === 'deepseek-r1:14b' || activeModel === 'local-assistant')) {
            onModelChange(selected.name);
          }
        } else {
          setModels([]);
          if (activeModel === 'deepseek-r1:14b') onModelChange('local-assistant');
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeModel, onModelChange]);

  useEffect(() => {
    let cancelled = false;
    const loadRuntime = () => {
      getJson<RuntimeResponse>('/runtime')
        .then((payload) => {
          if (!cancelled) setRuntime(payload.runtime);
        })
        .catch(() => {
          if (!cancelled) setRuntime({ state: 'error', label: 'runtime error' });
        });
    };
    loadRuntime();
    const timer = window.setInterval(loadRuntime, isStreaming ? 2000 : 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isStreaming]);

  const displayModel = activeModel === '__auto__' ? 'AUTO (registry)' : activeModel;
  const runtimeState = isStreaming ? 'generating' : runtime?.state || 'offline';
  const runtimeLabel = isStreaming ? 'generating' : runtime?.label || 'offline';
  const runtimeClass = runtimeState === 'generating'
    ? 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5'
    : runtimeState === 'ready'
    ? 'text-ttd-green border-ttd-green/30 bg-ttd-green/5'
    : runtimeState === 'loading'
    ? 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5'
    : 'text-ttd-red border-ttd-red/30 bg-ttd-red/5';
  const runtimeDot = runtimeState === 'ready'
    ? 'status-dot-green'
    : runtimeState === 'generating'
    ? ''
    : 'status-dot-dim';

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-ttd-border bg-ttd-surface/80 backdrop-blur-sm z-30 flex-shrink-0">
      {/* Hamburger */}
      <button
        onClick={onSidebarToggle}
        className="w-8 h-8 flex flex-col justify-center gap-1.5 items-center rounded hover:bg-ttd-elevated transition-colors group flex-shrink-0"
        aria-label="Chat history"
      >
        <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
        <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
        <span className="w-4 h-px bg-ttd-muted group-hover:bg-ttd-text transition-colors" />
      </button>

      {/* TTD ASCII compact logo */}
      <div
        className="cursor-pointer"
        onClick={() => router.push('/welcome-screen')}
        title="Back to welcome"
      >
        <pre className="ascii-text text-ttd-green text-[5px] leading-tight select-none"
          style={{ textShadow: '0 0 8px rgba(0,255,136,0.5)' }}>
          {ASCII_TTD_COMPACT}
        </pre>
      </div>

      <div className="w-px h-5 bg-ttd-border flex-shrink-0" />

      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-ttd-elevated border border-ttd-border rounded-sm p-0.5">
        <button
          onClick={() => onModeChange('instant')}
          disabled={isStreaming}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-semibold tracking-wider transition-all duration-150 ${
            mode === 'instant' ?'bg-ttd-cyan/15 text-ttd-cyan border border-ttd-cyan/30' :'text-ttd-muted hover:text-ttd-text'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Zap size={11} />
          INSTANT
        </button>
        <button
          onClick={() => onModeChange('expert')}
          disabled={isStreaming}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-semibold tracking-wider transition-all duration-150 ${
            mode === 'expert' ?'bg-ttd-green/10 text-ttd-green border border-ttd-green/30' :'text-ttd-muted hover:text-ttd-text'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Brain size={11} />
          EXPERT
        </button>
      </div>

      <div
        className={`hidden lg:flex items-center gap-2 border rounded-sm px-2.5 py-1.5 text-[10px] uppercase tracking-wider ${runtimeClass}`}
        title={runtime?.health || runtimeLabel}
      >
        <Activity size={11} />
        <span className={`status-dot ${runtimeDot}`} />
        <span>{runtimeLabel}</span>
      </div>

      {/* Model selector */}
      <div className="relative">
        <button
          onClick={() => setModelDropOpen(!modelDropOpen)}
          className="flex items-center gap-2 bg-ttd-elevated border border-ttd-border rounded-sm px-3 py-1.5 text-xs hover:border-ttd-border-bright transition-colors"
        >
          <span className={`status-dot ${models.length ? 'status-dot-green' : 'status-dot-dim'} flex-shrink-0`} />
          <span className="text-ttd-text">{models.length ? displayModel : 'No local model'}</span>
          <ChevronDown size={11} className="text-ttd-muted" />
        </button>

        {modelDropOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-ttd-surface border border-ttd-border rounded-sm shadow-xl z-50 animate-fade-in">
            <div className="px-3 py-2 border-b border-ttd-border">
              <span className="text-[10px] text-ttd-muted tracking-wider uppercase">Select Model</span>
            </div>
            {models.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-ttd-muted">
                No ready `.gguf` files found in models/.
              </div>
            )}
            {models.length > 0 && (
              <button
                onClick={() => { onModelChange('__auto__'); setModelDropOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-ttd-elevated transition-colors ${
                  activeModel === '__auto__' ? 'bg-ttd-elevated' : ''
                }`}
              >
                <div>
                  <div className="text-xs text-ttd-text">AUTO (registry)</div>
                  <div className="text-[10px] text-ttd-muted">chooses model by mode and task</div>
                </div>
                <span className="text-[9px] text-ttd-cyan border border-ttd-cyan/30 px-1 py-0.5 rounded-sm">FAST</span>
              </button>
            )}
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => { onModelChange(m.name); setModelDropOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-ttd-elevated transition-colors ${
                  m.name === activeModel ? 'bg-ttd-elevated' : ''
                }`}
              >
                <div>
                  <div className="text-xs text-ttd-text">{m.name}</div>
                  <div className="text-[10px] text-ttd-muted">
                    {m.type} · {m.vram} · {m.autoSelect ? 'AUTO' : 'MANUAL'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`status-dot ${m.status === 'ready' ? 'status-dot-green' : 'status-dot-dim'}`} />
                  {m.name === activeModel && (
                    <span className="text-[9px] text-ttd-green border border-ttd-green/30 px-1 py-0.5 rounded-sm">ACTIVE</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onNewChat}
          className="ttd-btn ttd-btn-ghost text-xs px-2 py-1 flex items-center gap-1"
          title="New conversation"
        >
          <Plus size={11} />
          NEW
        </button>
        <button
          onClick={() => router.push('/admin-panel')}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-ttd-elevated transition-colors"
          title="Admin panel"
        >
          <Shield size={13} className="text-ttd-muted" />
        </button>
      </div>
    </div>
  );
}
