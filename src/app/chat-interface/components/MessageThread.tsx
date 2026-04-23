'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, CheckCircle, XCircle, Terminal, FileCode, Image } from 'lucide-react';
import { toast } from 'sonner';
import type { Message, GeneratedFile } from './ChatInterfaceClient';

interface Props {
  messages: Message[];
  isStreaming: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

function CodeBlock({ file }: { file: GeneratedFile }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(`Copied ${file.name}`);
  };

  const handleDownload = () => {
    if (file.type === 'image_url') {
      window.open(file.content, '_blank', 'noopener,noreferrer');
      return;
    }
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${file.name}`);
  };

  if (file.type === 'image_url') {
    return (
      <div className="mt-3 border border-ttd-border rounded-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-ttd-elevated border-b border-ttd-border">
          <div className="flex items-center gap-2">
            <Image size={12} className="text-ttd-purple" />
            <span className="text-xs text-ttd-purple font-semibold">{file.name}</span>
            <span className="text-[10px] text-ttd-muted border border-ttd-border px-1 py-0.5 rounded-sm uppercase">
              {file.language || 'image'}
            </span>
          </div>
          <button
            onClick={handleDownload}
            className="ttd-btn ttd-btn-ghost px-2 py-0.5 text-[10px] flex items-center gap-1"
          >
            <Download size={10} />
            OPEN
          </button>
        </div>
        <div className="bg-ttd-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.content} alt={file.name} className="max-h-96 w-full object-contain border border-ttd-border rounded-sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 border border-ttd-border rounded-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-ttd-elevated border-b border-ttd-border">
        <div className="flex items-center gap-2">
          <FileCode size={12} className="text-ttd-cyan" />
          <span className="text-xs text-ttd-cyan font-semibold">{file.name}</span>
          {file.language && (
            <span className="text-[10px] text-ttd-muted border border-ttd-border px-1 py-0.5 rounded-sm uppercase">
              {file.language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="ttd-btn ttd-btn-ghost px-2 py-0.5 text-[10px] flex items-center gap-1"
          >
            <Copy size={10} />
            {copied ? 'COPIED' : 'COPY'}
          </button>
          <button
            onClick={handleDownload}
            className="ttd-btn ttd-btn-ghost px-2 py-0.5 text-[10px] flex items-center gap-1"
          >
            <Download size={10} />
            SAVE
          </button>
        </div>
      </div>
      <div className="code-block p-4 overflow-x-auto max-h-80">
        <pre className="text-[11px] text-ttd-text leading-relaxed whitespace-pre">
          {file.content}
        </pre>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (message.role === 'system') {
    return (
      <div className="flex justify-center px-4 py-2">
        <div className="message-system px-3 py-1.5 text-[11px] text-ttd-purple max-w-2xl text-center">
          ── {message.content} ──
        </div>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="px-4 py-3 flex justify-end animate-fade-in">
        <div className="max-w-2xl w-full">
          <div className="flex items-center justify-end gap-2 mb-1">
            <span className="text-[10px] text-ttd-muted">{message.ts}</span>
            <span className="text-[10px] text-ttd-cyan font-semibold tracking-wider">YOU</span>
          </div>
          <div className="message-user px-4 py-3">
            <p className="text-sm text-ttd-text leading-relaxed whitespace-pre-wrap">{message.content}</p>
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-1.5 bg-ttd-elevated border border-ttd-border rounded-sm px-2 py-1">
                    {att.type === 'image' ? <Image size={10} className="text-ttd-purple" /> : <FileCode size={10} className="text-ttd-cyan" />}
                    <span className="text-[10px] text-ttd-muted">{att.name}</span>
                    <span className="text-[10px] text-ttd-dim">{att.size}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="px-4 py-3 animate-fade-in">
      <div className="max-w-4xl w-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-ttd-green font-semibold tracking-wider">TTD</span>
          <span className="text-[10px] text-ttd-muted">{message.ts}</span>
          {message.tokensPerSec && (
            <span className="text-[10px] text-ttd-dim">
              {message.tokensPerSec} tok/s · {message.totalTokens} tokens
            </span>
          )}
          {message.streaming && (
            <div className="flex items-center gap-1 ml-1">
              <span className="text-[10px] text-ttd-green animate-pulse">streaming</span>
            </div>
          )}
        </div>

        {/* Thinking block (Expert mode) */}
        {message.thinking && (
          <div className="mb-2">
            {message.thinkingVisible ? (
              <div className="border border-ttd-purple/30 rounded-sm bg-[rgba(170,136,255,0.04)] overflow-hidden animate-fade-in">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-ttd-purple/20">
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={`think-dot-${i}`}
                        className="w-1 h-1 bg-ttd-purple rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-ttd-purple tracking-wider">THINKING...</span>
                </div>
                <div className="p-3">
                  <pre className="text-[11px] text-ttd-purple/70 leading-relaxed whitespace-pre-wrap font-mono">{message.thinking}</pre>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setThinkingOpen(!thinkingOpen)}
                className="flex items-center gap-1.5 text-[10px] text-ttd-muted hover:text-ttd-purple transition-colors"
              >
                {thinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Show reasoning chain</span>
              </button>
            )}
            {thinkingOpen && !message.thinkingVisible && (
              <div className="mt-1 border border-ttd-purple/20 rounded-sm bg-[rgba(170,136,255,0.03)] p-3 animate-fade-in">
                <pre className="text-[11px] text-ttd-purple/60 leading-relaxed whitespace-pre-wrap font-mono">{message.thinking}</pre>
              </div>
            )}
          </div>
        )}

        {/* Message content */}
        <div className="message-assistant px-4 py-3">
          <p className={`text-sm text-ttd-text leading-relaxed whitespace-pre-wrap ${message.streaming ? 'streaming-cursor' : ''}`}>
            {message.content}
            {message.streaming && !message.content && <span className="text-ttd-green animate-blink">█</span>}
          </p>

          {/* Generated files */}
          {message.generatedFiles && message.generatedFiles.map((file) => (
            <CodeBlock key={file.id} file={file} />
          ))}

          {/* Test result */}
          {message.testResult && (
            <div className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-sm border text-xs ${
              message.testResult.passed
                ? 'border-ttd-green/30 bg-[rgba(0,255,136,0.04)] text-ttd-green'
                : 'border-ttd-red/30 bg-[rgba(255,68,68,0.04)] text-ttd-red'
            }`}>
              {message.testResult.passed ? (
                <CheckCircle size={13} className="mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle size={13} className="mt-0.5 flex-shrink-0" />
              )}
              <div>
                <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                  <Terminal size={10} />
                  {message.testResult.passed ? 'TESTS PASSED' : 'TESTS FAILED'}
                </div>
                <div className="text-[11px] opacity-80 font-mono">{message.testResult.output}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessageThread({ messages, isStreaming, messagesEndRef }: Props) {
  return (
    <div className="flex-1 overflow-y-auto py-2">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <div className="text-ttd-dim text-xs mb-4">── NO MESSAGES ──</div>
          <p className="text-ttd-muted text-sm">Start typing below to begin a conversation.</p>
          <p className="text-ttd-dim text-xs mt-2">Attach files with the paperclip icon · /imagine for image generation</p>
        </div>
      ) : (
        messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
