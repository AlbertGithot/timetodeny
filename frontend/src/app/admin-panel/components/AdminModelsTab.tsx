'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Download, Trash2, Eye, EyeOff, Terminal, CheckCircle, AlertTriangle, Search, RefreshCw, Play, Square, Activity } from 'lucide-react';
import { getJson, postJson } from '@/lib/api';

interface ModelEntry {
  id: string;
  name: string;
  repoId: string;
  filename: string;
  type: 'text' | 'vision' | 'code';
  size: string;
  status: 'ready' | 'loading' | 'downloading' | 'error' | 'unloaded';
  vram: string;
  selected: boolean;
  hidden: boolean;
  systemPrompt: string;
  quantization: string;
  downloadProgress?: number;
  localPath?: string;
}

interface InstallForm {
  repoId: string;
  filename: string;
  modelType: 'text' | 'vision' | 'code';
  quantization: string;
}

interface SystemPromptForm {
  prompt: string;
}

interface SearchResult {
  repoId: string;
  name: string;
  type: 'text' | 'vision' | 'code';
  downloads: number;
  likes: number;
  pipelineTag: string;
  updatedAt: string;
  tags: string[];
  ggufFiles: string[];
}

const STATUS_CONFIG = {
  ready: { label: 'READY', cls: 'text-ttd-green border-ttd-green/30 bg-ttd-green/5' },
  loading: { label: 'LOADING', cls: 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5' },
  downloading: { label: 'DOWNLOADING', cls: 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5' },
  error: { label: 'ERROR', cls: 'text-ttd-red border-ttd-red/30 bg-ttd-red/5' },
  unloaded: { label: 'UNLOADED', cls: 'text-ttd-muted border-ttd-border' },
};

const TYPE_CONFIG = {
  text: { label: 'TEXT', cls: 'text-ttd-cyan border-ttd-cyan/30' },
  vision: { label: 'VISION', cls: 'text-ttd-purple border-ttd-purple/30' },
  code: { label: 'CODE', cls: 'text-ttd-green border-ttd-green/30' },
};

interface ModelsResponse {
  ok: boolean;
  models: ModelEntry[];
}

interface ModelResponse {
  ok: boolean;
  model: ModelEntry;
}

interface SearchResponse {
  ok: boolean;
  results: SearchResult[];
}

interface RuntimeInfo {
  backend: string;
  url: string;
  portOpen: boolean;
  running: boolean;
  managedPid?: number | null;
  managedPidRunning: boolean;
  selectedModel?: string | null;
  modelPath?: string | null;
  modelFileExists: boolean;
  binary?: string | null;
  binaryExists: boolean;
  logFile: string;
  logTail: string;
}

interface RuntimeResponse {
  ok: boolean;
  runtime: RuntimeInfo;
}

function inferQuantization(filename: string): string {
  const upper = filename.toUpperCase();
  const markers = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q5_K_S', 'Q4_K_M', 'Q4_K_S', 'Q3_K_M', 'Q2_K', 'F16'];
  return markers.find(marker => upper.includes(marker)) || 'Q4_K_M';
}

export default function AdminModelsTab() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [registrySearch, setRegistrySearch] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogType, setCatalogType] = useState<'all' | 'text' | 'vision' | 'code'>('all');
  const [catalogResults, setCatalogResults] = useState<SearchResult[]>([]);
  const [catalogSearched, setCatalogSearched] = useState(false);
  const [searchingCatalog, setSearchingCatalog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<InstallForm>({
    defaultValues: {
      modelType: 'text',
      quantization: 'Q4_K_M',
    },
  });
  const { register: regPrompt, handleSubmit: handlePromptSubmit, setValue: setPromptValue } = useForm<SystemPromptForm>();

  const loadModels = () => {
    getJson<ModelsResponse>('/models')
      .then(payload => setModels(payload.models))
      .catch((error: Error) => toast.error(error.message));
  };

  const loadRuntime = () => {
    getJson<RuntimeResponse>('/models/runtime', true)
      .then(payload => setRuntime(payload.runtime))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadModels();
    loadRuntime();
  }, []);

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(registrySearch.toLowerCase()) ||
    m.repoId.toLowerCase().includes(registrySearch.toLowerCase()) ||
    m.filename.toLowerCase().includes(registrySearch.toLowerCase())
  );

  const visibleModels = filtered.filter(m => !m.hidden);
  const hiddenModels = filtered.filter(m => m.hidden);

  const handleSelect = async (id: string) => {
    try {
      const payload = await postJson<ModelResponse>(`/models/${id}/select`, {}, true);
      setModels(prev => prev.map(m => m.id === id ? payload.model : { ...m, selected: false }));
      loadRuntime();
      toast.success(`${payload.model.name} selected for responses`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model select failed');
    }
  };

  const handleDeselect = async (id: string) => {
    try {
      const payload = await postJson<ModelResponse>(`/models/${id}/deselect`, {}, true);
      setModels(prev => prev.map(m => m.id === id ? payload.model : m));
      toast('Model deselected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model deselect failed');
    }
  };

  const handleHide = async (id: string) => {
    try {
      const payload = await postJson<ModelResponse>(`/models/${id}/hide`, {}, true);
      setModels(prev => prev.map(m => m.id === id ? payload.model : m));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hide failed');
    }
  };

  const handleShowAll = async () => {
    try {
      await postJson('/models/show-all', {}, true);
      setModels(prev => prev.map(m => ({ ...m, hidden: false })));
      toast.success('All models visible');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Show all failed');
    }
  };

  const handleHideAll = async () => {
    try {
      await postJson('/models/hide-all', {}, true);
      setModels(prev => prev.map(m => ({ ...m, hidden: true })));
      toast('All models hidden');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hide all failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await postJson(`/models/${id}/delete`, {}, true);
      setModels(prev => prev.filter(m => m.id !== id));
      setDeleteConfirm(null);
      loadRuntime();
      toast.success('Model removed from registry');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const handleEditPrompt = (model: ModelEntry) => {
    setEditingPrompt(model.id);
    setPromptValue('prompt', model.systemPrompt);
  };

  const handleSavePrompt = async (data: SystemPromptForm) => {
    if (!editingPrompt) return;
    try {
      const payload = await postJson<ModelResponse>(`/models/${editingPrompt}/prompt`, { prompt: data.prompt }, true);
      setModels(prev => prev.map(m => m.id === editingPrompt ? payload.model : m));
      setEditingPrompt(null);
      toast.success('System prompt updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Prompt update failed');
    }
  };

  const onInstall = async (data: InstallForm) => {
    setInstalling(true);
    setInstallProgress(8);
    const progressTimer = window.setInterval(() => {
      setInstallProgress(prev => Math.min(prev + 7, 92));
    }, 1500);
    try {
      const payload = await postJson<ModelResponse>('/models/install', { ...data, download: true }, true);
      setInstallProgress(100);
      setModels(prev => {
        const exists = prev.some(model => model.id === payload.model.id);
        return exists ? prev.map(model => model.id === payload.model.id ? payload.model : model) : [...prev, payload.model];
      });
      loadRuntime();
      reset();
      toast.success(`Model installed: ${data.filename}`);
    } catch (error) {
      loadModels();
      toast.error(error instanceof Error ? error.message : 'Install failed');
    } finally {
      window.clearInterval(progressTimer);
      setInstalling(false);
    }
  };

  const handleCatalogSearch = async () => {
    setSearchingCatalog(true);
    setCatalogSearched(true);
    try {
      const params = new URLSearchParams();
      if (catalogSearch.trim()) params.set('q', catalogSearch.trim());
      if (catalogType !== 'all') params.set('type', catalogType);
      params.set('limit', '8');

      const payload = await getJson<SearchResponse>(`/models/search?${params.toString()}`, true);
      setCatalogResults(payload.results);
      toast.success(payload.results.length ? `Found ${payload.results.length} model(s)` : 'No GGUF models found');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setSearchingCatalog(false);
    }
  };

  const applyCatalogResult = (result: SearchResult, filename: string) => {
    setValue('repoId', result.repoId);
    setValue('filename', filename);
    setValue('modelType', result.type);
    setValue('quantization', inferQuantization(filename));
    toast.success(`Install form filled from ${result.repoId}`);
  };

  const handleRuntimeRestart = async () => {
    setRuntimeBusy(true);
    try {
      const payload = await postJson<RuntimeResponse>('/models/restart', {}, true);
      setRuntime(payload.runtime);
      toast.success('llama.cpp restarted');
    } catch (error) {
      loadRuntime();
      toast.error(error instanceof Error ? error.message : 'Runtime restart failed');
    } finally {
      setRuntimeBusy(false);
    }
  };

  // Compatibility check
  const visionModels = models.filter(m => m.type === 'vision');
  const selectedModel = models.find(m => m.selected);
  const compatOk = selectedModel?.type !== 'vision';

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Compatibility checker */}
      <div className={`border rounded-sm px-4 py-3 flex items-start gap-3 ${
        compatOk
          ? 'border-ttd-green/30 bg-ttd-green/5' :'border-ttd-amber/30 bg-ttd-amber/5'
      }`}>
        {compatOk ? (
          <CheckCircle size={14} className="text-ttd-green mt-0.5 flex-shrink-0" />
        ) : (
          <AlertTriangle size={14} className="text-ttd-amber mt-0.5 flex-shrink-0" />
        )}
        <div>
          <div className={`text-xs font-semibold tracking-wider mb-0.5 ${compatOk ? 'text-ttd-green' : 'text-ttd-amber'}`}>
            COMPATIBILITY CHECK — {compatOk ? 'OK' : 'WARNING'}
          </div>
          <div className="text-[11px] text-ttd-muted">
            {compatOk
              ? `Active model: ${selectedModel?.name || 'none'} (${selectedModel?.type?.toUpperCase() || '—'}) · Compatible with chat interface · ${visionModels.length} vision model(s) available for /imagine`
              : `Vision model selected as primary — vision models cannot handle text chat. Select a TEXT or CODE model for chat responses.`
            }
          </div>
        </div>
      </div>

      {/* Runtime health */}
      <div className="bg-ttd-surface border border-ttd-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ttd-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity size={13} className={runtime?.running ? 'text-ttd-green' : 'text-ttd-red'} />
            <span className="text-xs font-bold tracking-wider text-ttd-text">LLAMA.CPP RUNTIME</span>
            <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${
              runtime?.running ? 'text-ttd-green border-ttd-green/30 bg-ttd-green/5' : 'text-ttd-red border-ttd-red/30 bg-ttd-red/5'
            }`}>
              {runtime?.running ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadRuntime}
              disabled={runtimeBusy}
              className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw size={10} />
              REFRESH
            </button>
            <button
              type="button"
              onClick={() => void handleRuntimeRestart()}
              disabled={runtimeBusy || !selectedModel}
              className="ttd-btn ttd-btn-green text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={10} className={runtimeBusy ? 'animate-spin' : ''} />
              RESTART MODEL
            </button>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">URL</div>
              <div className="text-ttd-cyan font-mono truncate" title={runtime?.url}>{runtime?.url || '-'}</div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">PID</div>
              <div className="text-ttd-text font-mono">
                {runtime?.managedPid ? `${runtime.managedPid}${runtime.managedPidRunning ? ' active' : ' stale'}` : '-'}
              </div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">MODEL</div>
              <div className="text-ttd-text font-mono truncate" title={runtime?.selectedModel || ''}>{runtime?.selectedModel || '-'}</div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">BINARY</div>
              <div className="text-ttd-text font-mono truncate" title={runtime?.binary || ''}>{runtime?.binary || '-'}</div>
            </div>
            <div className="md:col-span-2 bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">MODEL FILE</div>
              <div className={`${runtime?.modelFileExists ? 'text-ttd-green' : 'text-ttd-red'} font-mono truncate`} title={runtime?.modelPath || ''}>
                {runtime?.modelPath || 'No selected local model file'}
              </div>
            </div>
          </div>
          <div className="bg-ttd-bg border border-ttd-border rounded-sm p-3 min-h-36">
            <div className="text-[10px] text-ttd-muted mb-2 tracking-wider uppercase truncate" title={runtime?.logFile || ''}>
              {runtime?.logFile || 'runtime log'}
            </div>
            <pre className="text-[10px] text-ttd-dim whitespace-pre-wrap max-h-40 overflow-auto">
              {runtime?.logTail || 'No llama.cpp log lines yet.'}
            </pre>
          </div>
        </div>
      </div>

      {/* HuggingFace search */}
      <div className="bg-ttd-surface border border-ttd-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
          <Search size={13} className="text-ttd-purple" />
          <span className="text-xs font-bold tracking-wider text-ttd-text">SEARCH HUGGINGFACE GGUF MODELS</span>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_auto] gap-3">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ttd-dim" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCatalogSearch();
                  }
                }}
                placeholder="deepseek, qwen, mistral, flux..."
                className="ttd-input text-xs py-2 pl-8"
              />
            </div>
            <select
              value={catalogType}
              onChange={(e) => setCatalogType(e.target.value as 'all' | 'text' | 'vision' | 'code')}
              className="ttd-input text-xs"
            >
              <option value="all">ALL TYPES</option>
              <option value="text">TEXT</option>
              <option value="code">CODE</option>
              <option value="vision">VISION</option>
            </select>
            <button
              type="button"
              onClick={() => void handleCatalogSearch()}
              disabled={searchingCatalog}
              className="ttd-btn ttd-btn-cyan text-xs px-4 py-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={12} />
              {searchingCatalog ? 'SEARCHING...' : 'SEARCH HF'}
            </button>
          </div>

          <div className="text-[11px] text-ttd-dim">
            Search returns repos that actually contain `.gguf` files. Click a file button and the install form below fills itself.
          </div>

          {catalogResults.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {catalogResults.map((result) => (
                <div key={result.repoId} className="border border-ttd-border rounded-sm bg-ttd-elevated/40 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ttd-text truncate">{result.name}</div>
                      <div className="text-[11px] text-ttd-dim truncate">{result.repoId}</div>
                    </div>
                    <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${TYPE_CONFIG[result.type].cls}`}>
                      {TYPE_CONFIG[result.type].label}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">DOWNLOADS</div>
                      <div className="text-ttd-text font-mono">{result.downloads.toLocaleString()}</div>
                    </div>
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">LIKES</div>
                      <div className="text-ttd-purple font-mono">{result.likes.toLocaleString()}</div>
                    </div>
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">TASK</div>
                      <div className="text-ttd-cyan font-mono truncate">{result.pipelineTag || 'gguf'}</div>
                    </div>
                  </div>

                  {result.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {result.tags.map((tag) => (
                        <span key={`${result.repoId}-${tag}`} className="text-[10px] px-1.5 py-0.5 rounded-sm border border-ttd-border text-ttd-dim">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-[10px] text-ttd-muted tracking-wider uppercase">
                      GGUF Files {result.updatedAt ? `· Updated ${result.updatedAt}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.ggufFiles.map((filename) => (
                        <button
                          key={`${result.repoId}-${filename}`}
                          type="button"
                          onClick={() => applyCatalogResult(result, filename)}
                          className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1.5 max-w-full"
                          title={filename}
                        >
                          <span className="truncate inline-block max-w-[260px] align-bottom">{filename}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {catalogSearched && !searchingCatalog && catalogResults.length === 0 && (
            <div className="border border-ttd-border rounded-sm px-4 py-6 text-center text-ttd-muted text-sm">
              No GGUF repositories matched this search.
            </div>
          )}
        </div>
      </div>

      {/* Install form */}
      <div className="bg-ttd-surface border border-ttd-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
          <Download size={13} className="text-ttd-cyan" />
          <span className="text-xs font-bold tracking-wider text-ttd-text">INSTALL FROM HUGGINGFACE</span>
        </div>
        <form onSubmit={handleSubmit(onInstall)} className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">
                HuggingFace Repo ID
              </label>
              <input
                {...register('repoId', { required: 'Repo ID is required' })}
                placeholder="org/model-name-GGUF"
                className="ttd-input text-xs"
              />
              {errors.repoId && <p className="text-[10px] text-ttd-red mt-1">{errors.repoId.message}</p>}
            </div>
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">
                Filename (.gguf)
              </label>
              <input
                {...register('filename', { required: 'Filename is required', pattern: { value: /\.gguf$/, message: 'Must end in .gguf' } })}
                placeholder="model-q4_k_m.gguf"
                className="ttd-input text-xs"
              />
              {errors.filename && <p className="text-[10px] text-ttd-red mt-1">{errors.filename.message}</p>}
            </div>
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">
                Model Type
              </label>
              <select
                {...register('modelType', { required: true })}
                className="ttd-input text-xs"
              >
                <option value="text">TEXT (language model)</option>
                <option value="code">CODE (coding model)</option>
                <option value="vision">VISION (image generation)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">
                Quantization
              </label>
              <select {...register('quantization')} className="ttd-input text-xs">
                <option value="Q4_K_M">Q4_K_M (recommended)</option>
                <option value="Q5_K_M">Q5_K_M (higher quality)</option>
                <option value="Q3_K_M">Q3_K_M (smaller)</option>
                <option value="Q8_0">Q8_0 (near lossless)</option>
                <option value="F16">F16 (full precision)</option>
              </select>
            </div>
          </div>

          {installing && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-ttd-amber">Downloading from HuggingFace...</span>
                <span className="text-[10px] text-ttd-amber font-mono">{installProgress}%</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill-amber" style={{ width: `${installProgress}%` }} />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={installing}
            className="ttd-btn ttd-btn-cyan text-xs px-6 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={12} />
            {installing ? 'INSTALLING...' : 'INSTALL MODEL'}
          </button>
        </form>
      </div>

      {/* Registry controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ttd-dim" />
          <input
            type="text"
            value={registrySearch}
            onChange={(e) => setRegistrySearch(e.target.value)}
            placeholder="filter registry..."
            className="ttd-input text-xs py-2 pl-8"
          />
        </div>
        <div className="text-[10px] text-ttd-muted">{models.length} models · {models.filter(m => m.status === 'ready').length} ready</div>
        <button onClick={() => { setRegistrySearch(''); }} className="ttd-btn ttd-btn-ghost text-xs flex items-center gap-1.5 px-3 py-1">
          <Search size={11} />
          CLEAR FILTER
        </button>
        <button onClick={handleHideAll} className="ttd-btn ttd-btn-ghost text-xs flex items-center gap-1.5 px-3 py-1">
          <EyeOff size={11} />
          HIDE ALL
        </button>
        <button onClick={handleShowAll} className="ttd-btn ttd-btn-green text-xs flex items-center gap-1.5 px-3 py-1">
          <Eye size={11} />
          SHOW ALL
        </button>
      </div>

      {/* Model cards */}
      {hiddenModels.length > 0 && (
        <div className="text-[11px] text-ttd-dim px-1">
          {hiddenModels.length} hidden model(s) —
          <button onClick={handleShowAll} className="text-ttd-cyan ml-1 hover:underline">show all</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
        {visibleModels.map((model) => (
          <div
            key={model.id}
            className={`model-card p-4 ${model.selected ? 'model-card-active' : ''}`}
          >
            {/* Card header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-ttd-text truncate">{model.name}</span>
                  {model.selected && (
                    <span className="text-[9px] text-ttd-green border border-ttd-green/40 px-1 py-0.5 rounded-sm flex-shrink-0">ACTIVE</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${TYPE_CONFIG[model.type].cls}`}>
                    {TYPE_CONFIG[model.type].label}
                  </span>
                  <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${STATUS_CONFIG[model.status].cls}`}>
                    {STATUS_CONFIG[model.status].label}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleHide(model.id)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-ttd-elevated transition-colors flex-shrink-0 ml-2"
                title="Hide model"
              >
                <EyeOff size={11} className="text-ttd-dim hover:text-ttd-muted" />
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3 text-[10px]">
              <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                <div className="text-ttd-dim mb-0.5">SIZE</div>
                <div className="text-ttd-text font-mono">{model.size}</div>
              </div>
              <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                <div className="text-ttd-dim mb-0.5">VRAM</div>
                <div className="text-ttd-purple font-mono">{model.vram}</div>
              </div>
              <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                <div className="text-ttd-dim mb-0.5">QUANT</div>
                <div className="text-ttd-cyan font-mono">{model.quantization}</div>
              </div>
            </div>

            {/* Repo ID */}
            <div className="text-[10px] text-ttd-dim mb-3 truncate" title={model.repoId}>
              {model.repoId}
            </div>
            {model.localPath && (
              <div className="text-[10px] text-ttd-dim mb-3 truncate" title={model.localPath}>
                FILE: {model.localPath}
              </div>
            )}

            {/* System prompt preview */}
            {model.type !== 'vision' && (
              <div className="mb-3">
                {editingPrompt === model.id ? (
                  <form onSubmit={handlePromptSubmit(handleSavePrompt)} className="space-y-2">
                    <label className="block text-[10px] text-ttd-muted tracking-wider uppercase">System Prompt</label>
                    <textarea
                      {...regPrompt('prompt')}
                      rows={3}
                      className="ttd-input text-[11px] resize-none"
                    />
                    <div className="flex gap-2">
                      <button type="submit" className="ttd-btn ttd-btn-green text-[10px] px-3 py-1">SAVE</button>
                      <button type="button" onClick={() => setEditingPrompt(null)} className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1">CANCEL</button>
                    </div>
                  </form>
                ) : (
                  <div
                    className="bg-ttd-elevated border border-ttd-border rounded-sm px-2 py-1.5 text-[10px] text-ttd-muted cursor-pointer hover:border-ttd-border-bright transition-colors line-clamp-2"
                    onClick={() => handleEditPrompt(model)}
                    title="Click to edit system prompt"
                  >
                    {model.systemPrompt || <span className="text-ttd-dim italic">No system prompt — click to set</span>}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {model.selected ? (
                <button
                  onClick={() => handleDeselect(model.id)}
                  className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1"
                >
                  <Square size={10} />
                  DESELECT
                </button>
              ) : (
                <button
                  onClick={() => handleSelect(model.id)}
                  disabled={model.status !== 'ready'}
                  className="ttd-btn ttd-btn-green text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play size={10} />
                  SELECT
                </button>
              )}
              {model.type !== 'vision' && editingPrompt !== model.id && (
                <button
                  onClick={() => handleEditPrompt(model)}
                  className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1"
                >
                  <Terminal size={10} />
                  PROMPT
                </button>
              )}
              {model.status === 'error' && (
                <button
                  onClick={async () => {
                    try {
                      setModels(prev => prev.map(m => m.id === model.id ? { ...m, status: 'loading' } : m));
                      const payload = await postJson<ModelResponse>(`/models/${model.id}/reload`, {}, true);
                      setModels(prev => prev.map(m => m.id === model.id ? payload.model : m));
                      toast.success(`${model.name} reloaded`);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'Reload failed');
                    }
                  }}
                  className="ttd-btn ttd-btn-amber text-[10px] px-3 py-1 flex items-center gap-1"
                  style={{ borderColor: '#ffaa00', color: '#ffaa00', background: 'rgba(255,170,0,0.1)' }}
                >
                  <RefreshCw size={10} />
                  RELOAD
                </button>
              )}
              <button
                onClick={() => setDeleteConfirm(model.id)}
                className="ttd-btn ttd-btn-red text-[10px] px-3 py-1 flex items-center gap-1 ml-auto"
              >
                <Trash2 size={10} />
                DELETE
              </button>
            </div>
          </div>
        ))}
      </div>

      {visibleModels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-ttd-muted">
          <EyeOff size={24} className="mb-3 opacity-30" />
          <div className="text-sm mb-1">No models visible</div>
          <div className="text-xs text-ttd-dim mb-3">All models are hidden or no models match your search</div>
          <button onClick={handleShowAll} className="ttd-btn ttd-btn-green text-xs px-4 py-2">SHOW ALL MODELS</button>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-ttd-surface border border-ttd-red/40 rounded-sm p-6 w-full max-w-sm animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Trash2 size={16} className="text-ttd-red" />
              <span className="text-sm font-bold text-ttd-red tracking-wider">DELETE MODEL</span>
            </div>
            <p className="text-xs text-ttd-muted mb-2">
              Remove <span className="text-ttd-text font-semibold">{models.find(m => m.id === deleteConfirm)?.name}</span> from the registry?
            </p>
            <p className="text-[11px] text-ttd-dim mb-5">
              This will delete the model files and remove it from the registry. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => handleDelete(deleteConfirm)} className="ttd-btn ttd-btn-red flex-1 py-2 text-xs">
                DELETE PERMANENTLY
              </button>
              <button onClick={() => setDeleteConfirm(null)} className="ttd-btn ttd-btn-ghost flex-1 py-2 text-xs">
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
