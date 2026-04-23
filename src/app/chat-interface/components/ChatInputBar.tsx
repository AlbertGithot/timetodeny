'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Paperclip, Send, StopCircle, Image, X, FileCode } from 'lucide-react';
import { toast } from 'sonner';
import type { Mode, Attachment } from './ChatInterfaceClient';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  isStreaming: boolean;
  mode: Mode;
  pendingAttachments: Attachment[];
  onAttachmentsChange: (a: Attachment[]) => void;
}

export default function ChatInputBar({
  value, onChange, onSend, isStreaming, mode, pendingAttachments, onAttachmentsChange,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (isStreaming) return;
    if (!value.trim() && pendingAttachments.length === 0) return;
    onSend(value, pendingAttachments);
    onChange('');
    onAttachmentsChange([]);
  };

  const readAttachmentContent = (file: File): Promise<string> => (
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve('');
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file.slice(0, 256 * 1024));
      }
    })
  );

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = await Promise.all(files.map(async (f, i) => ({
      id: `att-${Date.now()}-${i}`,
      name: f.name,
      type: f.type.startsWith('image/') ? 'image' : 'file',
      size: `${(f.size / 1024).toFixed(1)}KB`,
      content: await readAttachmentContent(f),
    })));
    onAttachmentsChange([...pendingAttachments, ...newAttachments]);
    toast.success(`${files.length} file(s) attached`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    onAttachmentsChange(pendingAttachments.filter(a => a.id !== id));
  };

  const charCount = value.length;
  const isNearLimit = charCount > 3500;

  return (
    <div className="flex-shrink-0 border-t border-ttd-border bg-ttd-surface/80 backdrop-blur-sm">
      {/* Attachment previews */}
      {pendingAttachments.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {pendingAttachments.map((att) => (
            <div key={att.id} className="flex items-center gap-1.5 bg-ttd-elevated border border-ttd-border rounded-sm px-2 py-1.5 text-[11px]">
              {att.type === 'image' ? (
                <Image size={11} className="text-ttd-purple" />
              ) : (
                <FileCode size={11} className="text-ttd-cyan" />
              )}
              <span className="text-ttd-text">{att.name}</span>
              <span className="text-ttd-dim">{att.size}</span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="ml-1 hover:text-ttd-red transition-colors"
              >
                <X size={10} className="text-ttd-muted hover:text-ttd-red" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 flex items-end gap-3">
        {/* Attach button */}
        <div className="flex-shrink-0 flex gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-ttd-elevated border border-ttd-border hover:border-ttd-border-bright transition-all"
            title="Attach file"
          >
            <Paperclip size={13} className="text-ttd-muted" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileAttach}
            accept="*/*"
          />
        </div>

        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'expert' ?'> Enter prompt for extended reasoning... (Shift+Enter for newline)' :'> Enter prompt... (Shift+Enter for newline)'
            }
            rows={1}
            disabled={isStreaming}
            className="ttd-input resize-none overflow-hidden min-h-[40px] max-h-[200px] py-2.5 pr-16 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              height: 'auto',
              overflowY: value.split('\n').length > 5 ? 'auto' : 'hidden',
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
          />
          {/* Char count */}
          <span className={`absolute bottom-2 right-2 text-[9px] ${isNearLimit ? 'text-ttd-amber' : 'text-ttd-dim'}`}>
            {charCount > 0 ? `${charCount}` : ''}
          </span>
        </div>

        {/* Send/Stop button */}
        <button
          onClick={isStreaming ? undefined : handleSubmit}
          disabled={!isStreaming && !value.trim() && pendingAttachments.length === 0}
          className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-sm border transition-all duration-150 active:scale-95 ${
            isStreaming
              ? 'border-ttd-red/50 bg-ttd-red/10 text-ttd-red hover:bg-ttd-red/20 cursor-pointer'
              : value.trim() || pendingAttachments.length > 0
              ? mode === 'expert' ?'border-ttd-green/50 bg-ttd-green/10 text-ttd-green hover:bg-ttd-green/20' :'border-ttd-cyan/50 bg-ttd-cyan/10 text-ttd-cyan hover:bg-ttd-cyan/20' :'border-ttd-border text-ttd-dim cursor-not-allowed'
          }`}
          title={isStreaming ? 'Stop generation' : 'Send message (Enter)'}
        >
          {isStreaming ? <StopCircle size={15} /> : <Send size={14} />}
        </button>
      </div>

      {/* Footer hint */}
      <div className="px-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-ttd-dim">
          <span>Enter to send</span>
          <span>·</span>
          <span>Shift+Enter for newline</span>
          <span>·</span>
          <span>/imagine [prompt] for image gen</span>
        </div>
        <div className={`text-[10px] flex items-center gap-1.5 ${mode === 'expert' ? 'text-ttd-green' : 'text-ttd-cyan'}`}>
          <span className={`status-dot ${mode === 'expert' ? 'status-dot-green' : ''}`}
            style={mode === 'instant' ? { background: '#00ccff', boxShadow: '0 0 6px #00ccff' } : {}} />
          {mode.toUpperCase()} MODE
        </div>
      </div>
    </div>
  );
}
