'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle,
  Copy,
  FileCode,
  Folder,
  GitCompare,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  XCircle,
} from 'lucide-react';
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

interface TestResponse {
  ok: boolean;
  result: {
    path: string;
    passed: boolean;
    output: string;
  };
}

interface Props {
  chatId: string | null;
  refreshKey: string;
}

type ViewMode = 'code' | 'diff' | 'test';

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function parentDir(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function languageLabel(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || 'txt';
  return ext.slice(0, 8).toUpperCase();
}

export default function WorkspacePanel({ chatId, refreshKey }: Props) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [diff, setDiff] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('code');
  const [testResult, setTestResult] = useState<TestResponse['result'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadedChatId, setLoadedChatId] = useState<string | null>(null);

  const selectedFile = useMemo(
    () => files.find(file => file.path === selectedPath) || null,
    [files, selectedPath]
  );
  const dirty = content !== originalContent;
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, WorkspaceFile[]>();
    files.forEach((file) => {
      const dir = parentDir(file.path);
      groups.set(dir, [...(groups.get(dir) || []), file]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  const loadWorkspace = () => {
    if (!chatId) {
      setFiles([]);
      setSelectedPath('');
      setContent('');
      setOriginalContent('');
      setDiff('');
      setTestResult(null);
      setLoadedChatId(null);
      return;
    }
    setLoading(true);
    getJson<WorkspaceResponse>(`/workspaces/${chatId}`)
      .then((payload) => {
        const sorted = [...payload.workspace.files].sort((a, b) => a.path.localeCompare(b.path));
        setLoadedChatId(chatId);
        setFiles(sorted);
        const selectedStillExists = sorted.some(file => file.path === selectedPath);
        if (!selectedStillExists && sorted.length > 0) {
          setSelectedPath(sorted[0].path);
        }
        if (sorted.length === 0) {
          setSelectedPath('');
          setContent('');
          setOriginalContent('');
          setDiff('');
          setTestResult(null);
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
      setOriginalContent('');
      setDiff('');
      setTestResult(null);
      return;
    }
    getJson<FileResponse>(`/workspaces/${chatId}/file?path=${encodeURIComponent(selectedPath)}`)
      .then((payload) => {
        setContent(payload.file.content);
        setOriginalContent(payload.file.content);
        setDiff('');
        setTestResult(null);
        setViewMode('code');
      })
      .catch((error: Error) => {
        setContent('');
        setOriginalContent('');
        toast.error(error.message);
      });
  }, [chatId, selectedPath]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(viewMode === 'diff' ? diff : content);
    toast.success(`Copied ${selectedPath}`);
  };

  const handleZip = () => {
    if (!chatId) return;
    window.open(apiUrl(`/workspaces/${chatId}/zip`), '_blank', 'noopener,noreferrer');
  };

  const saveCurrentFile = async (): Promise<boolean> => {
    if (!chatId || !selectedPath) return false;
    setSaving(true);
    try {
      const payload = await postJson<FileResponse>(`/workspaces/${chatId}/file`, { path: selectedPath, content });
      setContent(payload.file.content);
      setOriginalContent(payload.file.content);
      setViewMode('code');
      loadWorkspace();
      toast.success(`Saved ${selectedPath}`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveCurrentFile();
  };

  const handleDiff = async () => {
    if (!chatId || !selectedPath) return;
    try {
      const payload = await getJson<DiffResponse>(`/workspaces/${chatId}/diff?path=${encodeURIComponent(selectedPath)}`);
      setDiff(payload.diff.hasPrevious ? payload.diff.diff : 'No previous version for this file.');
      setViewMode('diff');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Diff failed');
    }
  };

  const handleRunTest = async () => {
    if (!chatId || !selectedPath) return;
    if (dirty) {
      const saved = await saveCurrentFile();
      if (!saved) return;
    }
    setTesting(true);
    try {
      const payload = await postJson<TestResponse>(`/workspaces/${chatId}/test`, { path: selectedPath });
      setTestResult(payload.result);
      setViewMode('test');
      if (payload.result.passed) {
        toast.success('Tests passed');
      } else {
        toast.error('Tests failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleRollback = async () => {
    if (!chatId || !selectedPath) return;
    try {
      const payload = await postJson<FileResponse>(`/workspaces/${chatId}/rollback`, { path: selectedPath });
      setContent(payload.file.content);
      setOriginalContent(payload.file.content);
      setDiff('');
      setTestResult(null);
      setViewMode('code');
      loadWorkspace();
      toast.success(`Rolled back ${selectedPath}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rollback failed');
    }
  };

  if (!chatId || loadedChatId !== chatId || files.length === 0) {
    return null;
  }

  return (
    <aside className="hidden xl:flex w-[440px] 2xl:w-[520px] flex-shrink-0 border-l border-ttd-border bg-ttd-surface/70 flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
        <FileCode size={13} className="text-ttd-cyan" />
        <span className="text-xs font-bold tracking-wider text-ttd-text">WORKSPACE</span>
        <span className="text-[10px] text-ttd-muted">{files.length} files</span>
        {dirty && <span className="text-[10px] text-ttd-amber">unsaved</span>}
        <button onClick={loadWorkspace} className="ml-auto w-7 h-7 flex items-center justify-center rounded-sm hover:bg-ttd-elevated" title="Refresh files">
          <RefreshCw size={12} className={loading ? 'text-ttd-cyan animate-spin' : 'text-ttd-muted'} />
        </button>
        <button onClick={handleZip} className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-ttd-elevated" title="Download workspace ZIP">
          <Archive size={12} className="text-ttd-green" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] flex-shrink-0 border-r border-ttd-border overflow-auto bg-ttd-bg/40">
          {groupedFiles.map(([dir, items]) => (
            <div key={dir} className="border-b border-ttd-border/40">
              <div className="px-3 py-2 flex items-center gap-1.5 text-[10px] text-ttd-muted bg-ttd-surface/50">
                <Folder size={10} className="text-ttd-green" />
                <span className="truncate" title={dir}>{dir}</span>
              </div>
              {items.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full px-3 py-2 text-left hover:bg-ttd-elevated transition-colors ${
                    file.path === selectedPath ? 'bg-ttd-elevated border-l border-ttd-cyan' : 'border-l border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileCode size={10} className="text-ttd-cyan flex-shrink-0" />
                    <span className="text-[11px] text-ttd-text truncate" title={file.path}>{file.name}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-ttd-dim">{sizeLabel(file.size)}</div>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 flex flex-col">
          <div className="px-3 py-2 border-b border-ttd-border flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ttd-text truncate" title={selectedPath}>{selectedPath}</div>
              <div className="text-[10px] text-ttd-muted">
                {selectedFile ? `${languageLabel(selectedPath)} · ${sizeLabel(selectedFile.size)}` : 'No file selected'}
              </div>
            </div>
            <button onClick={handleCopy} disabled={!selectedFile} className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40" title="Copy current view">
              <Copy size={10} />
              COPY
            </button>
            <button onClick={handleSave} disabled={!selectedFile || !dirty || saving} className="ttd-btn ttd-btn-cyan text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40" title="Save edited file">
              <Save size={10} />
              {saving ? 'SAVING' : 'SAVE'}
            </button>
          </div>

          <div className="px-3 py-2 border-b border-ttd-border flex items-center gap-2">
            {(['code', 'diff', 'test'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2 py-1 text-[10px] border rounded-sm uppercase tracking-wider ${
                  viewMode === mode ? 'text-ttd-green border-ttd-green/40 bg-ttd-green/10' : 'text-ttd-muted border-ttd-border hover:text-ttd-text'
                }`}
              >
                {mode}
              </button>
            ))}
            <button onClick={handleDiff} disabled={!selectedFile} className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 ml-auto disabled:opacity-40">
              <GitCompare size={10} />
              DIFF
            </button>
            <button onClick={handleRunTest} disabled={!selectedFile || testing} className="ttd-btn ttd-btn-green text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40">
              <Play size={10} />
              {testing ? 'RUNNING' : 'RUN'}
            </button>
            <button onClick={handleRollback} disabled={!selectedFile} className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-40">
              <RotateCcw size={10} />
              UNDO
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden bg-ttd-bg">
            {viewMode === 'code' && (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
                className="w-full h-full resize-none bg-transparent p-4 text-[11px] leading-relaxed text-ttd-text font-mono outline-none whitespace-pre"
              />
            )}
            {viewMode === 'diff' && (
              <pre className="h-full overflow-auto p-4 text-[11px] leading-relaxed text-ttd-text whitespace-pre">
                {diff || 'Run DIFF to compare this file with its previous version.'}
              </pre>
            )}
            {viewMode === 'test' && (
              <div className="h-full overflow-auto p-4">
                {testResult ? (
                  <div className={`border rounded-sm p-3 text-xs ${
                    testResult.passed ? 'border-ttd-green/35 text-ttd-green bg-ttd-green/5' : 'border-ttd-red/35 text-ttd-red bg-ttd-red/5'
                  }`}>
                    <div className="flex items-center gap-2 font-semibold mb-2">
                      {testResult.passed ? <CheckCircle size={13} /> : <XCircle size={13} />}
                      {testResult.passed ? 'TESTS PASSED' : 'TESTS FAILED'}
                    </div>
                    <pre className="text-[11px] whitespace-pre-wrap opacity-85">{testResult.output}</pre>
                  </div>
                ) : (
                  <div className="text-xs text-ttd-muted">Run TEST to validate the selected file.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
