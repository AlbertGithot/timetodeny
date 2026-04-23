'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Download, Trash2, Eye, EyeOff, Terminal, CheckCircle, AlertTriangle, Search, RefreshCw, Play, Square } from 'lucide-react';

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
}

interface InstallForm {
  repoId: string;
  filename: string;
  modelType: 'text' | 'vision';
  quantization: string;
}

interface SystemPromptForm {
  prompt: string;
}

const INITIAL_MODELS: ModelEntry[] = [
  {
    id: 'model-deepseek',
    name: 'deepseek-r1:14b',
    repoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B-GGUF',
    filename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    type: 'text',
    size: '8.99GB',
    status: 'ready',
    vram: '9.2GB',
    selected: true,
    hidden: false,
    systemPrompt: 'You are TTD, a highly capable local AI assistant. Be concise, precise, and technical. Prefer code over prose when applicable.',
    quantization: 'Q4_K_M',
  },
  {
    id: 'model-qwen',
    name: 'qwen2.5-coder:7b',
    repoId: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    filename: 'qwen2.5-coder-7b-instruct-q5_k_m.gguf',
    type: 'code',
    size: '5.09GB',
    status: 'ready',
    vram: '5.1GB',
    selected: false,
    hidden: false,
    systemPrompt: 'You are an expert code assistant. Generate clean, well-commented, production-ready code. Always include error handling.',
    quantization: 'Q5_K_M',
  },
  {
    id: 'model-llama',
    name: 'llama3.3:70b',
    repoId: 'bartowski/Llama-3.3-70B-Instruct-GGUF',
    filename: 'Llama-3.3-70B-Instruct-Q3_K_M.gguf',
    type: 'text',
    size: '29.1GB',
    status: 'unloaded',
    vram: '42GB',
    selected: false,
    hidden: false,
    systemPrompt: 'You are a helpful, harmless, and honest AI assistant with deep reasoning capabilities.',
    quantization: 'Q3_K_M',
  },
  {
    id: 'model-flux',
    name: 'flux-dev',
    repoId: 'black-forest-labs/FLUX.1-dev-gguf',
    filename: 'flux1-dev-Q8_0.gguf',
    type: 'vision',
    size: '15.6GB',
    status: 'ready',
    vram: '7.8GB',
    selected: false,
    hidden: false,
    systemPrompt: '',
    quantization: 'Q8_0',
  },
  {
    id: 'model-phi4',
    name: 'phi-4:14b',
    repoId: 'microsoft/phi-4-gguf',
    filename: 'phi-4-q4.gguf',
    type: 'text',
    size: '8.1GB',
    status: 'error',
    vram: '—',
    selected: false,
    hidden: true,
    systemPrompt: 'You are Phi, a helpful AI assistant by Microsoft.',
    quantization: 'Q4_0',
    downloadProgress: 0,
  },
];

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

export default function AdminModelsTab() {
  const [models, setModels] = useState<ModelEntry[]>(INITIAL_MODELS);
  const [search, setSearch] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InstallForm>();
  const { register: regPrompt, handleSubmit: handlePromptSubmit, setValue: setPromptValue, formState: { errors: promptErrors } } = useForm<SystemPromptForm>();

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.repoId.toLowerCase().includes(search.toLowerCase())
  );

  const visibleModels = filtered.filter(m => !m.hidden);
  const hiddenModels = filtered.filter(m => m.hidden);

  const handleSelect = (id: string) => {
    setModels(prev => prev.map(m => ({ ...m, selected: m.id === id })));
    const model = models.find(m => m.id === id);
    toast.success(`${model?.name} selected for responses`);
  };

  const handleDeselect = (id: string) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, selected: false } : m));
    toast('Model deselected');
  };

  const handleHide = (id: string) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, hidden: true } : m));
  };

  const handleShowAll = () => {
    setModels(prev => prev.map(m => ({ ...m, hidden: false })));
    toast.success('All models visible');
  };

  const handleHideAll = () => {
    setModels(prev => prev.map(m => ({ ...m, hidden: true })));
    toast('All models hidden');
  };

  const handleDelete = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id));
    setDeleteConfirm(null);
    toast.success('Model removed from registry');
  };

  const handleEditPrompt = (model: ModelEntry) => {
    setEditingPrompt(model.id);
    setPromptValue('prompt', model.systemPrompt);
  };

  const handleSavePrompt = (data: SystemPromptForm) => {
    setModels(prev => prev.map(m => m.id === editingPrompt ? { ...m, systemPrompt: data.prompt } : m));
    setEditingPrompt(null);
    toast.success('System prompt updated');
  };

  const onInstall = (data: InstallForm) => {
    setInstalling(true);
    setInstallProgress(0);
    // TODO: Backend integration — POST /api/models/install with { repoId, filename, type }
    const interval = setInterval(() => {
      setInstallProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setInstalling(false);
          const newModel: ModelEntry = {
            id: `model-new-${Date.now()}`,
            name: data.filename.replace('.gguf', ''),
            repoId: data.repoId,
            filename: data.filename,
            type: data.modelType,
            size: '—',
            status: 'ready',
            vram: '—',
            selected: false,
            hidden: false,
            systemPrompt: '',
            quantization: data.quantization || 'Q4_K_M',
          };
          setModels(prev => [...prev, newModel]);
          reset();
          toast.success(`Model installed: ${data.filename}`);
          return 100;
        }
        return prev + 2;
      });
    }, 80);
  };

  // Compatibility check
  const textModels = models.filter(m => m.type === 'text' || m.type === 'code');
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search models..."
            className="ttd-input text-xs py-2 pl-8"
          />
        </div>
        <div className="text-[10px] text-ttd-muted">{models.length} models · {models.filter(m => m.status === 'ready').length} ready</div>
        <button onClick={() => { setSearch(''); }} className="ttd-btn ttd-btn-ghost text-xs flex items-center gap-1.5 px-3 py-1">
          <Search size={11} />
          FIND ALL
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
                  onClick={() => {
                    setModels(prev => prev.map(m => m.id === model.id ? { ...m, status: 'loading' } : m));
                    setTimeout(() => {
                      setModels(prev => prev.map(m => m.id === model.id ? { ...m, status: 'ready' } : m));
                      toast.success(`${model.name} reloaded`);
                    }, 2000);
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