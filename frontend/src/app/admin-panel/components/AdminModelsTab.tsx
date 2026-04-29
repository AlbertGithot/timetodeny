'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  performance: PerformanceSettings;
}

interface PerformanceSettings {
  autoSelect: boolean;
  useForInstant: boolean;
  useForExpert: boolean;
  instantContextMessages: number;
  expertContextMessages: number;
  instantMaxTokens: number;
  expertMaxTokens: number;
  llamaContextSize: number;
  llamaThreads: number;
  llamaGpuLayers: number;
  promptCacheEnabled: boolean;
  runTests: boolean;
  maxTestFiles: number;
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

type InstallJobStatus = 'queued' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';

interface InstallJob {
  id: string;
  repoId: string;
  filename: string;
  type: 'text' | 'vision' | 'code';
  quantization: string;
  status: InstallJobStatus;
  progress: number;
  bytesDownloaded: number;
  bytesTotal: number;
  downloadedLabel: string;
  totalLabel: string;
  speedLabel: string;
  etaLabel: string;
  log: string;
  errorDetails?: string | null;
  localPath: string;
  model?: ModelEntry | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG = {
  ready: { label: 'READY', cls: 'text-ttd-green border-ttd-green/30 bg-ttd-green/5' },
  loading: { label: 'LOADING', cls: 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5' },
  downloading: { label: 'DOWNLOADING', cls: 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5' },
  error: { label: 'ERROR', cls: 'text-ttd-red border-ttd-red/30 bg-ttd-red/5' },
  unloaded: { label: 'UNLOADED', cls: 'text-ttd-muted border-ttd-border' },
};

const INSTALL_STATUS_CONFIG: Record<InstallJobStatus, { label: string; cls: string; bar: string }> = {
  queued: { label: 'QUEUED', cls: 'text-ttd-muted border-ttd-border bg-ttd-elevated', bar: 'progress-bar-fill-cyan' },
  downloading: { label: 'DOWNLOADING', cls: 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5', bar: 'progress-bar-fill-amber' },
  verifying: { label: 'VERIFYING', cls: 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5', bar: 'progress-bar-fill-cyan' },
  ready: { label: 'READY', cls: 'text-ttd-green border-ttd-green/30 bg-ttd-green/5', bar: 'progress-bar-fill-green' },
  failed: { label: 'FAILED', cls: 'text-ttd-red border-ttd-red/30 bg-ttd-red/5', bar: 'progress-bar-fill-red' },
  cancelled: { label: 'CANCELLED', cls: 'text-ttd-muted border-ttd-border bg-ttd-elevated', bar: 'progress-bar-fill-red' },
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

interface ImportLocalResponse {
  ok: boolean;
  models: ModelEntry[];
  modelDir: string;
}

interface ModelResponse {
  ok: boolean;
  model: ModelEntry;
}

interface ModelActionResponse {
  ok: boolean;
  model: ModelEntry;
  runtime?: RuntimeInfo;
  check?: LaunchCheck;
}

interface SearchResponse {
  ok: boolean;
  results: SearchResult[];
}

interface InstallJobsResponse {
  ok: boolean;
  jobs: InstallJob[];
}

interface InstallJobResponse {
  ok: boolean;
  job: InstallJob;
}

interface RuntimeInfo {
  backend: string;
  url: string;
  host?: string;
  port?: number;
  portOpen: boolean;
  ready?: boolean;
  health?: string;
  running: boolean;
  managedPid?: number | null;
  managedPidRunning: boolean;
  process?: {
    pid: number;
    source: string;
    name: string;
    status: string;
    cpuPercent: number;
    memoryRss: number;
    memoryRssLabel: string;
    uptimeSeconds: number;
    uptimeLabel: string;
    cmdline: string;
  } | null;
  generation?: {
    busy: boolean;
    queued: boolean;
    currentChatId?: string | null;
    startedSecondsAgo: number;
    queuedSecondsAgo: number;
    active?: {
      chatId: string;
      messageId: string;
      status: string;
      phase: string;
      activity: string;
      progress: number;
      etaLabel?: string;
    } | null;
  };
  selectedModel?: string | null;
  modelPath?: string | null;
  modelFileExists: boolean;
  binary?: string | null;
  binaryExists: boolean;
  logFile: string;
  logTail: string;
}

interface LaunchCheck {
  ok: boolean;
  message: string;
  errors: string[];
  warnings: string[];
  model?: string | null;
  modelPath?: string | null;
  binary?: string | null;
  url: string;
  host: string;
  port: number;
  ready: boolean;
  health: string;
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

function defaultPerformance(): PerformanceSettings {
  return {
    autoSelect: true,
    useForInstant: true,
    useForExpert: true,
    instantContextMessages: 4,
    expertContextMessages: 12,
    instantMaxTokens: 512,
    expertMaxTokens: 2048,
    llamaContextSize: 0,
    llamaThreads: 0,
    llamaGpuLayers: -1,
    promptCacheEnabled: true,
    runTests: true,
    maxTestFiles: 2,
  };
}

function normalizePerformance(settings?: Partial<PerformanceSettings>): PerformanceSettings {
  return { ...defaultPerformance(), ...(settings || {}) };
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
  const [detailModelId, setDetailModelId] = useState<string | null>(null);
  const [submittingInstall, setSubmittingInstall] = useState(false);
  const [installJobs, setInstallJobs] = useState<InstallJob[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<PerformanceSettings>(defaultPerformance());
  const [settingsBusy, setSettingsBusy] = useState(false);
  const seenReadyJobsRef = useRef<Set<string>>(new Set());

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

  const loadInstallJobs = () => {
    getJson<InstallJobsResponse>('/models/install-jobs', true)
      .then((payload) => {
        setInstallJobs(payload.jobs);
        const newReadyJobs = payload.jobs.filter(job => job.status === 'ready' && !seenReadyJobsRef.current.has(job.id));
        if (newReadyJobs.length > 0) {
          newReadyJobs.forEach(job => seenReadyJobsRef.current.add(job.id));
          loadModels();
          loadRuntime();
        }
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadModels();
    loadRuntime();
    loadInstallJobs();
  }, []);

  const hasActiveInstallJob = installJobs.some(job => ['queued', 'downloading', 'verifying'].includes(job.status));

  useEffect(() => {
    if (!hasActiveInstallJob) return;
    const timer = window.setInterval(loadInstallJobs, 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveInstallJob]);

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
      if (detailModelId === id) setDetailModelId(null);
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
    setSubmittingInstall(true);
    try {
      const payload = await postJson<InstallJobResponse>('/models/install-jobs', data, true);
      setInstallJobs(prev => [payload.job, ...prev.filter(job => job.id !== payload.job.id)]);
      reset();
      if (payload.job.status === 'ready') {
        loadModels();
        loadRuntime();
        toast.success(`Model installed: ${data.filename}`);
      } else {
        toast.success(`Install queued: ${data.filename}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Install failed');
    } finally {
      setSubmittingInstall(false);
    }
  };

  const handleCancelInstall = async (id: string) => {
    try {
      const payload = await postJson<InstallJobResponse>(`/models/install-jobs/${id}/cancel`, {}, true);
      setInstallJobs(prev => prev.map(job => job.id === id ? payload.job : job));
      toast('Install cancellation requested');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cancel failed');
    }
  };

  const handleRetryInstall = async (id: string) => {
    try {
      const payload = await postJson<InstallJobResponse>(`/models/install-jobs/${id}/retry`, {}, true);
      setInstallJobs(prev => [payload.job, ...prev]);
      toast.success(`Retry queued: ${payload.job.filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed');
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

  const handleRuntimeStop = async () => {
    setRuntimeBusy(true);
    try {
      const payload = await postJson<RuntimeResponse>('/models/stop', {}, true);
      setRuntime(payload.runtime);
      toast('llama.cpp stopped');
    } catch (error) {
      loadRuntime();
      toast.error(error instanceof Error ? error.message : 'Runtime stop failed');
    } finally {
      setRuntimeBusy(false);
    }
  };

  const handleModelRuntimeAction = async (id: string, action: 'start' | 'stop' | 'check') => {
    setRuntimeBusy(true);
    try {
      const payload = await postJson<ModelActionResponse>(`/models/${id}/${action}`, {}, true);
      setModels(prev => prev.map(m => m.id === id ? payload.model : action === 'start' ? { ...m, selected: false } : m));
      if (payload.runtime) setRuntime(payload.runtime);
      if (action === 'start') toast.success(`${payload.model.name} started`);
      if (action === 'stop') toast('llama.cpp stopped');
      if (action === 'check') {
        const warnings = payload.check?.warnings?.length ? ` · ${payload.check.warnings.join(' · ')}` : '';
        const errors = payload.check?.errors?.length ? ` · ${payload.check.errors.join(' · ')}` : '';
        if (payload.check?.ok) {
          toast.success(`${payload.check?.message || 'Launch check passed'}${warnings}`);
        } else {
          toast.error(`${payload.check?.message || 'Launch check failed'}${errors}`);
        }
      }
    } catch (error) {
      loadRuntime();
      toast.error(error instanceof Error ? error.message : `${action} failed`);
    } finally {
      setRuntimeBusy(false);
    }
  };

  const handleQuickProfile = async (id: string, profile: 'instant-profile' | 'expert-profile') => {
    try {
      const payload = await postJson<ModelResponse>(`/models/${id}/${profile}`, {}, true);
      setModels(prev => prev.map(m => m.id === id ? payload.model : m));
      setSettingsDraft(normalizePerformance(payload.model.performance));
      toast.success(profile === 'instant-profile' ? 'Instant profile applied' : 'Expert profile applied');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Profile update failed');
    }
  };

  const handleImportLocal = async () => {
    try {
      const payload = await postJson<ImportLocalResponse>('/models/import-local', {}, true);
      setModels(payload.models);
      loadRuntime();
      toast.success(`Synced ${payload.models.length} local model(s) from ${payload.modelDir}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Local import failed');
    }
  };

  // Compatibility check
  const visionModels = models.filter(m => m.type === 'vision');
  const selectedModel = models.find(m => m.selected);
  const detailModel = visibleModels.find(m => m.id === detailModelId) || selectedModel || visibleModels[0] || null;
  const compatOk = selectedModel?.type !== 'vision';

  useEffect(() => {
    if (detailModel) {
      setSettingsDraft(normalizePerformance(detailModel.performance));
    }
  }, [detailModel?.id]);

  const updateSettingsDraft = <K extends keyof PerformanceSettings>(key: K, value: PerformanceSettings[K]) => {
    setSettingsDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = async () => {
    if (!detailModel) return;
    setSettingsBusy(true);
    try {
      const payload = await postJson<ModelResponse>(`/models/${detailModel.id}/settings`, { performance: settingsDraft }, true);
      setModels(prev => prev.map(m => m.id === detailModel.id ? payload.model : m));
      loadRuntime();
      toast.success('Model routing and speed settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Settings update failed');
    } finally {
      setSettingsBusy(false);
    }
  };

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
            <button
              type="button"
              onClick={() => void handleRuntimeStop()}
              disabled={runtimeBusy || !runtime?.managedPid}
              className="ttd-btn ttd-btn-red text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Square size={10} />
              STOP
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
              <div className="text-ttd-dim mb-1">PORT</div>
              <div className="text-ttd-text font-mono">
                {runtime?.host || '-'}:{runtime?.port || '-'} · {runtime?.portOpen ? 'open' : 'closed'}
              </div>
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
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">PROCESS</div>
              <div className="text-ttd-text font-mono truncate" title={runtime?.process?.cmdline || ''}>
                {runtime?.process ? `${runtime.process.name} · ${runtime.process.source}` : '-'}
              </div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">LOAD</div>
              <div className="text-ttd-text font-mono">
                {runtime?.process ? `${runtime.process.cpuPercent.toFixed(1)}% CPU · ${runtime.process.memoryRssLabel} RAM` : '-'}
              </div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">UPTIME</div>
              <div className="text-ttd-text font-mono">{runtime?.process?.uptimeLabel || '-'}</div>
            </div>
            <div className="bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">GENERATION QUEUE</div>
              <div className="text-ttd-text font-mono truncate" title={runtime?.generation?.active?.activity || ''}>
                {runtime?.generation?.active
                  ? `${runtime.generation.active.phase} · ${runtime.generation.active.progress}% · ETA ${runtime.generation.active.etaLabel || '-'}`
                  : runtime?.generation?.busy ? 'busy' : 'idle'}
              </div>
            </div>
            <div className="md:col-span-2 bg-ttd-elevated rounded-sm px-3 py-2">
              <div className="text-ttd-dim mb-1">MODEL FILE</div>
              <div className={`${runtime?.modelFileExists ? 'text-ttd-green' : 'text-ttd-red'} font-mono truncate`} title={runtime?.modelPath || ''}>
                {runtime?.modelPath || 'No selected local model file'}
              </div>
            </div>
            {runtime?.generation?.active && (
              <div className="md:col-span-2 bg-ttd-bg border border-ttd-green/25 rounded-sm px-3 py-2">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="text-ttd-green text-[10px] tracking-wider uppercase">Active request</div>
                  <div className="text-ttd-green font-mono text-[10px]">{runtime.generation.active.progress}%</div>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill-green" style={{ width: `${Math.max(1, Math.min(99, runtime.generation.active.progress))}%` }} />
                </div>
                <div className="text-[10px] text-ttd-muted mt-2 truncate" title={runtime.generation.active.activity}>
                  {runtime.generation.active.activity}
                </div>
              </div>
            )}
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

          <button
            type="submit"
            disabled={submittingInstall}
            className="ttd-btn ttd-btn-cyan text-xs px-6 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={12} />
            {submittingInstall ? 'QUEUEING...' : 'INSTALL MODEL'}
          </button>
        </form>
      </div>

      {/* Install jobs */}
      <div className="bg-ttd-surface border border-ttd-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ttd-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Download size={13} className="text-ttd-amber" />
            <span className="text-xs font-bold tracking-wider text-ttd-text">MODEL INSTALL JOBS</span>
            <span className="text-[10px] text-ttd-muted">{installJobs.length} tracked</span>
          </div>
          <button
            type="button"
            onClick={loadInstallJobs}
            className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1"
          >
            <RefreshCw size={10} />
            REFRESH
          </button>
        </div>
        {installJobs.length === 0 ? (
          <div className="p-4 text-xs text-ttd-muted">
            No installs yet. Pick a GGUF file above and this panel will show real progress, not the old decorative nonsense.
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {installJobs.slice(0, 8).map((job) => {
              const config = INSTALL_STATUS_CONFIG[job.status];
              const active = ['queued', 'downloading', 'verifying'].includes(job.status);
              return (
                <div key={job.id} className="border border-ttd-border rounded-sm bg-ttd-elevated/35 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ttd-text truncate" title={job.filename}>{job.filename}</div>
                      <div className="text-[11px] text-ttd-dim truncate" title={job.repoId}>{job.repoId}</div>
                    </div>
                    <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${config.cls}`}>
                      {config.label}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] text-ttd-muted">
                        {job.downloadedLabel} / {job.totalLabel}
                      </span>
                      <span className="text-[10px] text-ttd-amber font-mono">{job.progress}%</span>
                    </div>
                    <div className="progress-bar-track">
                      <div className={config.bar} style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">SPEED</div>
                      <div className="text-ttd-cyan font-mono">{job.speedLabel}</div>
                    </div>
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">ETA</div>
                      <div className="text-ttd-text font-mono">{job.etaLabel}</div>
                    </div>
                    <div className="bg-ttd-bg rounded-sm px-2 py-1.5">
                      <div className="text-ttd-dim mb-0.5">UPDATED</div>
                      <div className="text-ttd-muted font-mono">{job.updatedAt}</div>
                    </div>
                  </div>

                  {job.localPath && (
                    <div className="text-[10px] text-ttd-dim truncate" title={job.localPath}>
                      LOCAL: {job.localPath}
                    </div>
                  )}

                  {job.log && (
                    <pre className="bg-ttd-bg border border-ttd-border rounded-sm p-2 text-[10px] text-ttd-dim whitespace-pre-wrap max-h-28 overflow-auto">
                      {job.log}
                    </pre>
                  )}

                  {job.errorDetails && (
                    <div className="border border-ttd-red/30 bg-ttd-red/5 rounded-sm px-3 py-2 text-[11px] text-ttd-red">
                      {job.errorDetails}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {active && (
                      <button
                        type="button"
                        onClick={() => void handleCancelInstall(job.id)}
                        className="ttd-btn ttd-btn-red text-[10px] px-3 py-1 flex items-center gap-1"
                      >
                        <Square size={10} />
                        CANCEL
                      </button>
                    )}
                    {['failed', 'cancelled'].includes(job.status) && (
                      <button
                        type="button"
                        onClick={() => void handleRetryInstall(job.id)}
                        className="ttd-btn ttd-btn-amber text-[10px] px-3 py-1 flex items-center gap-1"
                        style={{ borderColor: '#ffaa00', color: '#ffaa00', background: 'rgba(255,170,0,0.1)' }}
                      >
                        <RefreshCw size={10} />
                        RETRY
                      </button>
                    )}
                    {job.status === 'ready' && job.model && (
                      <button
                        type="button"
                        onClick={() => void handleSelect(job.model!.id)}
                        className="ttd-btn ttd-btn-green text-[10px] px-3 py-1 flex items-center gap-1 ml-auto"
                      >
                        <Play size={10} />
                        SELECT
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
        <button onClick={handleImportLocal} className="ttd-btn ttd-btn-cyan text-xs flex items-center gap-1.5 px-3 py-1">
          <RefreshCw size={11} />
          FIND LOCAL MODELS
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

      {/* Registry table + detail panel */}
      {hiddenModels.length > 0 && (
        <div className="text-[11px] text-ttd-dim px-1">
          {hiddenModels.length} hidden model(s) -
          <button onClick={handleShowAll} className="text-ttd-cyan ml-1 hover:underline">show all</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
        <div className="border border-ttd-border rounded-sm overflow-hidden bg-ttd-surface">
          <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
            <Terminal size={13} className="text-ttd-cyan" />
            <span className="text-xs font-bold tracking-wider text-ttd-text">MODEL REGISTRY</span>
            <span className="ml-auto text-[10px] text-ttd-muted">{visibleModels.length} visible</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ttd-border bg-ttd-elevated">
                  <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">MODEL</th>
                  <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">TYPE</th>
                  <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">STATUS</th>
                  <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">SIZE</th>
                  <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">QUANT</th>
                  <th className="text-right px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visibleModels.map((model) => (
                  <tr
                    key={model.id}
                    onClick={() => setDetailModelId(model.id)}
                    className={`border-b border-ttd-border/50 hover:bg-ttd-elevated/50 cursor-pointer ${
                      detailModel?.id === model.id ? 'bg-ttd-elevated/60' : ''
                    } ${model.selected ? 'outline outline-1 outline-ttd-green/20' : ''}`}
                  >
                    <td className="px-3 py-2.5 min-w-56">
                      <div className="flex items-center gap-2">
                        <span className={`status-dot ${model.selected ? 'status-dot-green' : 'status-dot-dim'}`} />
                        <span className="text-ttd-text font-semibold truncate max-w-[260px]" title={model.name}>{model.name}</span>
                        {model.selected && <span className="text-[9px] text-ttd-green border border-ttd-green/40 px-1 py-0.5 rounded-sm">ACTIVE</span>}
                      </div>
                      <div className="text-[10px] text-ttd-dim truncate mt-1" title={model.filename}>{model.filename}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${TYPE_CONFIG[model.type].cls}`}>
                        {TYPE_CONFIG[model.type].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${STATUS_CONFIG[model.status].cls}`}>
                        {STATUS_CONFIG[model.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ttd-muted font-mono whitespace-nowrap">{model.size}</td>
                    <td className="px-3 py-2.5 text-ttd-cyan font-mono whitespace-nowrap">{model.quantization}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {model.selected ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); void handleDeselect(model.id); }}
                            className="ttd-btn ttd-btn-ghost text-[10px] px-2 py-1"
                          >
                            OFF
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); void handleSelect(model.id); }}
                            disabled={model.status !== 'ready'}
                            className="ttd-btn ttd-btn-green text-[10px] px-2 py-1 disabled:opacity-40"
                          >
                            SELECT
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleHide(model.id); }}
                          className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-ttd-elevated"
                          title="Hide model"
                        >
                          <EyeOff size={11} className="text-ttd-muted" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(model.id); }}
                          className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-ttd-red/10"
                          title="Delete model"
                        >
                          <Trash2 size={11} className="text-ttd-red" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleModels.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-ttd-muted">
              <EyeOff size={24} className="mb-3 opacity-30" />
              <div className="text-sm mb-1">No models visible</div>
              <div className="text-xs text-ttd-dim mb-3">All models are hidden or no models match your search</div>
              <button onClick={handleShowAll} className="ttd-btn ttd-btn-green text-xs px-4 py-2">SHOW ALL MODELS</button>
            </div>
          )}
        </div>

        <div className="border border-ttd-border rounded-sm bg-ttd-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
            <Activity size={13} className="text-ttd-green" />
            <span className="text-xs font-bold tracking-wider text-ttd-text">MODEL DETAILS</span>
          </div>
          {!detailModel ? (
            <div className="p-4 text-xs text-ttd-muted">Select a model from the registry.</div>
          ) : (
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-ttd-text truncate">{detailModel.name}</span>
                  {detailModel.selected && <span className="text-[9px] text-ttd-green border border-ttd-green/40 px-1 py-0.5 rounded-sm">ACTIVE</span>}
                </div>
                <div className="text-[10px] text-ttd-dim truncate" title={detailModel.repoId}>{detailModel.repoId}</div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                  <div className="text-ttd-dim mb-0.5">SIZE</div>
                  <div className="text-ttd-text font-mono">{detailModel.size}</div>
                </div>
                <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                  <div className="text-ttd-dim mb-0.5">VRAM</div>
                  <div className="text-ttd-purple font-mono">{detailModel.vram}</div>
                </div>
                <div className="bg-ttd-elevated rounded-sm px-2 py-1.5">
                  <div className="text-ttd-dim mb-0.5">QUANT</div>
                  <div className="text-ttd-cyan font-mono">{detailModel.quantization}</div>
                </div>
              </div>

              <div className="text-[10px] text-ttd-dim space-y-1">
                <div className="truncate" title={detailModel.filename}>FILE: {detailModel.filename}</div>
                {detailModel.localPath && <div className="truncate" title={detailModel.localPath}>LOCAL: {detailModel.localPath}</div>}
              </div>

              {detailModel.type !== 'vision' && (
                <div>
                  {editingPrompt === detailModel.id ? (
                    <form onSubmit={handlePromptSubmit(handleSavePrompt)} className="space-y-2">
                      <label className="block text-[10px] text-ttd-muted tracking-wider uppercase">System Prompt</label>
                      <textarea {...regPrompt('prompt')} rows={6} className="ttd-input text-[11px] resize-none" />
                      <div className="flex gap-2">
                        <button type="submit" className="ttd-btn ttd-btn-green text-[10px] px-3 py-1">SAVE</button>
                        <button type="button" onClick={() => setEditingPrompt(null)} className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1">CANCEL</button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleEditPrompt(detailModel)}
                      className="w-full text-left bg-ttd-elevated border border-ttd-border rounded-sm px-3 py-2 text-[10px] text-ttd-muted hover:border-ttd-border-bright"
                    >
                      {detailModel.systemPrompt || <span className="text-ttd-dim italic">No system prompt - click to set</span>}
                    </button>
                  )}
                </div>
              )}

              {detailModel.type !== 'vision' && (
                <div className="border border-ttd-border rounded-sm bg-ttd-elevated/35 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-ttd-muted tracking-wider uppercase">Routing & Speed</div>
                      <div className="text-[10px] text-ttd-dim">Used by AUTO model selection and llama.cpp startup.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveSettings()}
                      disabled={settingsBusy}
                      className="ttd-btn ttd-btn-cyan text-[10px] px-3 py-1 disabled:opacity-50"
                    >
                      {settingsBusy ? 'SAVING' : 'SAVE'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {[
                      ['autoSelect', 'AUTO SELECT'],
                      ['useForInstant', 'INSTANT'],
                      ['useForExpert', 'EXPERT'],
                      ['promptCacheEnabled', 'PROMPT CACHE'],
                      ['runTests', 'TEST FILES'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 bg-ttd-bg/70 border border-ttd-border rounded-sm px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(settingsDraft[key as keyof PerformanceSettings])}
                          onChange={(e) => updateSettingsDraft(key as keyof PerformanceSettings, e.target.checked as never)}
                          className="accent-ttd-green"
                        />
                        <span className="text-ttd-muted">{label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">Instant history</span>
                      <input
                        type="number"
                        min={0}
                        max={32}
                        value={settingsDraft.instantContextMessages}
                        onChange={(e) => updateSettingsDraft('instantContextMessages', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">Expert history</span>
                      <input
                        type="number"
                        min={0}
                        max={64}
                        value={settingsDraft.expertContextMessages}
                        onChange={(e) => updateSettingsDraft('expertContextMessages', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">Instant tokens</span>
                      <input
                        type="number"
                        min={0}
                        max={8192}
                        value={settingsDraft.instantMaxTokens}
                        onChange={(e) => updateSettingsDraft('instantMaxTokens', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">Expert tokens</span>
                      <input
                        type="number"
                        min={0}
                        max={16384}
                        value={settingsDraft.expertMaxTokens}
                        onChange={(e) => updateSettingsDraft('expertMaxTokens', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">llama ctx</span>
                      <input
                        type="number"
                        min={0}
                        value={settingsDraft.llamaContextSize}
                        onChange={(e) => updateSettingsDraft('llamaContextSize', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                        placeholder="0 = env"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">threads</span>
                      <input
                        type="number"
                        min={0}
                        value={settingsDraft.llamaThreads}
                        onChange={(e) => updateSettingsDraft('llamaThreads', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                        placeholder="0 = auto"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">GPU layers</span>
                      <input
                        type="number"
                        min={-1}
                        value={settingsDraft.llamaGpuLayers}
                        onChange={(e) => updateSettingsDraft('llamaGpuLayers', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                        placeholder="-1 = env/default"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] text-ttd-dim uppercase">max tests</span>
                      <input
                        type="number"
                        min={0}
                        max={32}
                        value={settingsDraft.maxTestFiles}
                        onChange={(e) => updateSettingsDraft('maxTestFiles', Number(e.target.value))}
                        className="ttd-input text-xs py-1"
                      />
                    </label>
                  </div>
                  <div className="text-[10px] text-ttd-dim">
                    `0` tokens means llama.cpp default. Changing llama ctx/threads/GPU on active model restarts llama-server.
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => void handleModelRuntimeAction(detailModel.id, 'check')}
                  disabled={runtimeBusy || detailModel.status !== 'ready'}
                  className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  <Activity size={10} />
                  CHECK
                </button>
                <button
                  onClick={() => void handleModelRuntimeAction(detailModel.id, 'start')}
                  disabled={runtimeBusy || detailModel.status !== 'ready' || detailModel.type === 'vision'}
                  className="ttd-btn ttd-btn-green text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  <Play size={10} />
                  START
                </button>
                <button
                  onClick={() => void handleModelRuntimeAction(detailModel.id, 'stop')}
                  disabled={runtimeBusy || !runtime?.managedPid}
                  className="ttd-btn ttd-btn-red text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  <Square size={10} />
                  STOP
                </button>
                <button
                  onClick={() => void handleQuickProfile(detailModel.id, 'instant-profile')}
                  disabled={detailModel.type === 'vision'}
                  className="ttd-btn ttd-btn-cyan text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  INSTANT
                </button>
                <button
                  onClick={() => void handleQuickProfile(detailModel.id, 'expert-profile')}
                  disabled={detailModel.type === 'vision'}
                  className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  EXPERT
                </button>
                {detailModel.selected ? (
                  <button onClick={() => void handleDeselect(detailModel.id)} className="ttd-btn ttd-btn-ghost text-[10px] px-3 py-1 flex items-center gap-1">
                    <Square size={10} />
                    DESELECT
                  </button>
                ) : (
                  <button onClick={() => void handleSelect(detailModel.id)} disabled={detailModel.status !== 'ready'} className="ttd-btn ttd-btn-green text-[10px] px-3 py-1 flex items-center gap-1 disabled:opacity-40">
                    <Play size={10} />
                    SELECT
                  </button>
                )}
                {detailModel.status === 'error' && (
                  <button
                    onClick={async () => {
                      try {
                        setModels(prev => prev.map(m => m.id === detailModel.id ? { ...m, status: 'loading' } : m));
                        const payload = await postJson<ModelResponse>(`/models/${detailModel.id}/reload`, {}, true);
                        setModels(prev => prev.map(m => m.id === detailModel.id ? payload.model : m));
                        toast.success(`${detailModel.name} reloaded`);
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
                <button onClick={() => setDeleteConfirm(detailModel.id)} className="ttd-btn ttd-btn-red text-[10px] px-3 py-1 flex items-center gap-1 ml-auto">
                  <Trash2 size={10} />
                  DELETE
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
