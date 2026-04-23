'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import ChatSidebar from './ChatSidebar';
import MessageThread from './MessageThread';
import ChatInputBar from './ChatInputBar';
import ChatHeader from './ChatHeader';

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

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'msg-sys-001',
    role: 'system',
    content: 'Session started. Model: deepseek-r1:14b · Mode: EXPERT · Context: 128k tokens',
    ts: '11:22:03',
  },
  {
    id: 'msg-u-001',
    role: 'user',
    content: 'Write a Rust async function that reads a file line by line and processes each line concurrently using tokio. Include error handling.',
    ts: '11:22:14',
  },
  {
    id: 'msg-a-001',
    role: 'assistant',
    content: `Here's a Rust async function using Tokio that reads a file line by line and processes each line concurrently:`,
    ts: '11:22:31',
    thinking: `Let me think through this carefully. The user wants:
1. Async file reading in Rust
2. Line-by-line processing
3. Concurrent processing with Tokio
4. Proper error handling

I'll use tokio::fs, BufReader, and tokio::spawn for concurrency. Need to handle the JoinHandle results too.`,
    thinkingVisible: false,
    tokensPerSec: 42.3,
    totalTokens: 387,
    generatedFiles: [
      {
        id: 'file-001',
        name: 'async_file_processor.rs',
        language: 'rust',
        type: 'code',
        content: `use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::task::JoinHandle;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Task join error: {0}")]
    Join(#[from] tokio::task::JoinError),
}

async fn process_line(line: String, line_num: usize) -> Result<String, ProcessError> {
    // Simulate async processing (e.g., DB lookup, API call)
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    Ok(format!("[{}] processed: {}", line_num, line.trim()))
}

pub async fn process_file_concurrent<P: AsRef<Path>>(
    path: P,
) -> Result<Vec<String>, ProcessError> {
    let file = File::open(path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    
    let mut handles: Vec<JoinHandle<Result<String, ProcessError>>> = Vec::new();
    let mut line_num = 0usize;
    
    while let Some(line) = lines.next_line().await? {
        line_num += 1;
        let handle = tokio::spawn(process_line(line, line_num));
        handles.push(handle);
    }
    
    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        let result = handle.await??;
        results.push(result);
    }
    
    Ok(results)
}

#[tokio::main]
async fn main() -> Result<(), ProcessError> {
    let results = process_file_concurrent("input.txt").await?;
    for r in &results {
        println!("{}", r);
    }
    println!("\\nProcessed {} lines concurrently.", results.len());
    Ok(())
}`,
      },
    ],
    testResult: { passed: true, output: 'cargo test: 3/3 passed · cargo check: OK · clippy: 0 warnings' },
  },
  {
    id: 'msg-u-002',
    role: 'user',
    content: 'Can you also add a semaphore to limit max concurrency to N tasks at once?',
    ts: '11:24:02',
  },
  {
    id: 'msg-a-002',
    role: 'assistant',
    content: 'Absolutely. Using `tokio::sync::Semaphore` with `Arc` to limit concurrent tasks:',
    ts: '11:24:18',
    tokensPerSec: 38.7,
    totalTokens: 214,
    thinking: `The user wants to add a concurrency limit. I'll use Arc<Semaphore> and acquire a permit before spawning each task. The semaphore permit needs to be moved into the spawned task to keep it alive for the duration.`,
    thinkingVisible: false,
    generatedFiles: [
      {
        id: 'file-002',
        name: 'semaphore_patch.rs',
        language: 'rust',
        type: 'code',
        content: `use std::sync::Arc;
use tokio::sync::Semaphore;

pub async fn process_file_limited<P: AsRef<Path>>(
    path: P,
    max_concurrent: usize,
) -> Result<Vec<String>, ProcessError> {
    let file = File::open(path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    
    let semaphore = Arc::new(Semaphore::new(max_concurrent));
    let mut handles: Vec<JoinHandle<Result<String, ProcessError>>> = Vec::new();
    let mut line_num = 0usize;
    
    while let Some(line) = lines.next_line().await? {
        line_num += 1;
        let sem = Arc::clone(&semaphore);
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            process_line(line, line_num).await
        });
        handles.push(handle);
    }
    
    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        results.push(handle.await??);
    }
    Ok(results)
}`,
      },
    ],
  },
];

export default function ChatInterfaceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as Mode) || 'instant';

  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeModel, setActiveModel] = useState('deepseek-r1:14b');
  const [inputValue, setInputValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback((text: string, attachments: Attachment[]) => {
    if (!text.trim() && attachments.length === 0) return;

    const userMsg: Message = {
      id: `msg-u-${Date.now()}`,
      role: 'user',
      content: text,
      ts: new Date().toTimeString().slice(0, 8),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    // Simulate streaming response
    // TODO: Backend integration — POST /api/chat with { message, model, mode, history }
    const streamingId = `msg-a-${Date.now()}`;
    const thinkingText = mode === 'expert'
      ? `Analyzing the request...\nConsidering context from previous messages...\nFormulating a structured response...`
      : undefined;

    const assistantMsg: Message = {
      id: streamingId,
      role: 'assistant',
      content: '',
      ts: new Date().toTimeString().slice(0, 8),
      streaming: true,
      thinking: thinkingText,
      thinkingVisible: mode === 'expert',
    };

    setMessages(prev => [...prev, assistantMsg]);

    const fullResponse = `I've analyzed your request. Here's my response based on the current context and the ${mode === 'expert' ? 'extended reasoning chain' : 'direct inference'} mode.\n\nThe key considerations are:\n1. Context window utilization is currently at 23%\n2. Previous code has been analyzed for consistency\n3. All generated code will be tested before delivery`;

    let charIndex = 0;
    const streamInterval = setInterval(() => {
      if (charIndex < fullResponse.length) {
        const chunk = fullResponse.slice(0, charIndex + 3);
        setMessages(prev => prev.map(m =>
          m.id === streamingId
            ? { ...m, content: chunk, thinkingVisible: false }
            : m
        ));
        charIndex += 3;
      } else {
        clearInterval(streamInterval);
        setMessages(prev => prev.map(m =>
          m.id === streamingId
            ? { ...m, content: fullResponse, streaming: false, tokensPerSec: 41.2, totalTokens: 156 }
            : m
        ));
        setIsStreaming(false);
        toast.success('Response complete · 156 tokens · 41.2 tok/s');
      }
    }, 30);
  }, [mode]);

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