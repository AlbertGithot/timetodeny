'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Copy, FileCode, GitCompare, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiUrl, getJson, postJson } from '@/lib/api';

interface WorkspaceFile {
  path: string;
  name: string;
  type: 'file';
  size: number;
  updatedAt: number;
}

interface WorkspaceResponse {
  ok: boolean;
  workspace: {
    root: string;
    directories: string[];
    files: WorkspaceFile[];
    fileCount: number;
  };
}

interface FileResponse {
  ok: boolean;
  file: {
    path: string;
    name: string;
    size: number;
    content: string;
    updatedAt: number;
  };
}

interface DiffResponse {
  ok: boolean;
  diff: {
    path: string;
    hasPrevious: boolean;
    diff: string;
  };
}

interface Props {
  chatId: string | null;
  refreshKey: string;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

export default function WorkspacePanel({ chatId, refreshKey }: Props) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [content, setContent] = useState('');
  const [diff, setDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedFile = useMemo(
    () => files.find(file => file.path === selectedPath) || null,
    [files, selectedPath]
  );

  const loadWorkspace = () => {
    if (!chatId) {
      setFiles([]);
      setSelectedPath('');
      setContent('');
      setDiff('');
      return;
    }
    setLoading(true);
    getJson<WorkspaceResponse>(`/workspaces/${chatId}`)
      .then((payload) => {
        setFiles(payload.workspace.files);
        if (!selectedPath && payload.workspace.files.length > 0) {
          setSelectedPath(payload.workspace.files[0].path);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, refreshKey]);

  useEffect(() => {
    if (!chatId || !selectedPath) {
      setContent('');
      setDiff('');
      return;
    }
    getJson<FileResponse>(`/workspaces/${chatId}/file?path=${encodeURIComponent(selectedPath)}`)
      .then(payload => setContent(payload.file.content))
      .catch((error: Error) => {
        setContent('');
        toast.error(error.message);
      });
  }, [chatId, selectedPath]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    toast.success(`Copied ${selectedPath}`);
  };

  const handleZip = () => {
    if (!chatId) return;
    window.open(apiUrl(`/workspaces/${chatId}/zip`), '_blank', 'noopener,noreferrer');
  };

  const handleDiff = async () => {
    if (!chatId || !selectedPath) return;
    try {
      const payload = await getJson<DiffResponse>(`/workspaces/${chatId}/diff?path=${encodeURIComponent(selectedPath)}`);
      setDiff(payload.diff.hasPrevious ? payload.diff.diff : 'No previous version for this file.');
      setShowDiff(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Diff failed');
    }
  };

  const handleRollback = async () => {
    if (!chatId || !selectedPath) return;
    try {
      const payload = await postJson<FileResponse>(`/workspaces/${chatId}/rollback`, { path: selectedPath });
      setContent(payload.file.content);
      setShowDiff(false);
      loadWorkspace();
      toast.success(`Rolled back ${selectedPath}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rollback failed');
    }
  };

  return (
    <aside className="hidden xl:flex w-[360px] 2xl:w-[420px] flex-shrink-0 border-l border-ttd-border bg-ttd-surface/60 flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
        <FileCode size={13} className="text-ttd-cyan" />
        <span className="text-xs font-bold tracking-wider text-ttd-text">FILES</span>
        <span className="ml-auto text-[10px] text-ttd-muted">{files.length}</span>
        <button onClick={loadWorkspace} className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-ttd-elevated" title="Refresh files">
          <RefreshCw size={12} className={loading ? 'text-ttd-cyan animate-spin' : 'text-ttd-muted'} />
        </button>
      </div>

      {!chatId ? (
        <div className="p-4 text-xs text-ttd-muted">Start a chat to open its workspace.</div>
      ) : files.length === 0 ? (
        <div className="p-4 text-xs text-ttd-muted">No generated files in this chat yet.</div>
      ) : (
        <>
          <div className="max-h-52 overflow-auto border-b border-ttd-border">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => { setSelectedPath(file.path); setShowDiff(false); }}
                className={`w-full px-4 py-2.5 text-left border-b border-ttd-border/40 hover:bg-ttd-elevated transition-colors ${
                  file.path === selectedPath ? 'bg-ttd-elevated' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileCode size={11} className="text-ttd-cyan flex-shrink-0" />
                  <span className="text-xs text-ttd-text truncate">{file.path}</span>
                </div>
                <div className="mt-1 text-[10px] text-ttd-dim">{sizeLabel(file.size)}</div>
              </button>
            ))}
          </div>

          <div className="px-4 py-2 border-b border-ttd-border flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!selectedFile}
              className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40"
            >
              <Copy size={10} />
              COPY
            </button>
            <button
              onClick={handleDiff}
              disabled={!selectedFile}
              className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40"
            >
              <GitCompare size={10} />
              DIFF
            </button>
            <button
              onClick={handleRollback}
              disabled={!selectedFile}
              className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40"
            >
              <RotateCcw size={10} />
              ROLLBACK
            </button>
            <button
              onClick={handleZip}
              className="ttd-btn ttd-btn-green text-[10px] px-2 py-1 flex items-center gap-1 ml-auto"
            >
              <Archive size={10} />
              ZIP
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-ttd-bg">
            <div className="px-4 py-2 border-b border-ttd-border text-[10px] text-ttd-muted truncate">
              {showDiff ? `DIFF: ${selectedPath}` : selectedPath}
            </div>
            <pre className="p-4 text-[11px] leading-relaxed text-ttd-text whitespace-pre overflow-x-auto">
              {showDiff ? diff : content}
            </pre>
          </div>
        </>
      )}
    </aside>
  );
}
