'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Search, Download } from 'lucide-react';
import { toast } from 'sonner';

interface RequestEntry {
  id: string;
  ip: string;
  ts: string;
  model: string;
  mode: string;
  query: string;
  response: string;
  status: 'success' | 'error' | 'timeout' | 'streaming';
  latency: string;
  tokens: number;
  errorDetails?: string;
}

const REQUESTS: RequestEntry[] = [
  { id: 'req-001', ip: '127.0.0.1', ts: '2026-04-23 11:22:14', model: 'deepseek-r1:14b', mode: 'expert', query: 'Write a Rust async function that reads a file line by line...', response: 'Here\'s a Rust async function using Tokio...', status: 'success', latency: '2.34s', tokens: 387 },
  { id: 'req-002', ip: '127.0.0.1', ts: '2026-04-23 11:24:02', model: 'deepseek-r1:14b', mode: 'expert', query: 'Can you also add a semaphore to limit max concurrency...', response: 'Absolutely. Using tokio::sync::Semaphore with Arc...', status: 'success', latency: '1.87s', tokens: 214 },
  { id: 'req-003', ip: '192.168.1.44', ts: '2026-04-23 10:55:11', model: 'qwen2.5-coder:7b', mode: 'instant', query: 'Generate a FastAPI CRUD boilerplate for a users table', response: 'Here is a complete FastAPI CRUD implementation...', status: 'success', latency: '0.92s', tokens: 512 },
  { id: 'req-004', ip: '192.168.1.44', ts: '2026-04-23 10:41:33', model: 'flux-dev', mode: 'instant', query: '/imagine cyberpunk city at dusk, neon rain, 4k', response: '[IMAGE_GENERATED: cyberpunk_city_01.png]', status: 'success', latency: '14.2s', tokens: 0 },
  { id: 'req-005', ip: '10.0.0.2', ts: '2026-04-23 09:18:47', model: 'llama3.3:70b', mode: 'expert', query: 'Explain multi-head attention with mathematical notation', response: '', status: 'timeout', latency: '30.0s', tokens: 0, errorDetails: 'Request exceeded 30s timeout threshold. Model was mid-generation at token 847. CUDA context may be degraded — recommend model reload.' },
  { id: 'req-006', ip: '127.0.0.1', ts: '2026-04-23 09:02:15', model: 'deepseek-r1:14b', mode: 'instant', query: 'What is the capital of France?', response: 'Paris.', status: 'success', latency: '0.21s', tokens: 4 },
  { id: 'req-007', ip: '10.0.0.5', ts: '2026-04-23 08:44:09', model: 'qwen2.5-coder:7b', mode: 'instant', query: 'Write unit tests for a JWT auth module in Python', response: 'Here are comprehensive unit tests...', status: 'success', latency: '1.44s', tokens: 631 },
  { id: 'req-008', ip: '10.0.0.5', ts: '2026-04-23 08:30:52', model: 'llama3.3:70b', mode: 'expert', query: 'Summarize the Mamba2 state space model paper', response: '', status: 'error', latency: '0.08s', tokens: 0, errorDetails: 'Model not loaded: llama3.3:70b is not in active state. Call /api/models/load with model_id before sending requests. Current VRAM budget: 14.2GB free.' },
  { id: 'req-009', ip: '127.0.0.1', ts: '2026-04-22 23:47:18', model: 'flux-dev', mode: 'instant', query: '/imagine abstract data flow visualization, purple cyan', response: '[IMAGE_GENERATED: abstract_flow_01.png]', status: 'success', latency: '11.7s', tokens: 0 },
  { id: 'req-010', ip: '192.168.1.44', ts: '2026-04-22 22:11:03', model: 'deepseek-r1:14b', mode: 'expert', query: 'Optimize this CUDA kernel for matrix multiplication...', response: 'Here are several optimization strategies...', status: 'success', latency: '3.12s', tokens: 892 },
  { id: 'req-011', ip: '10.0.0.2', ts: '2026-04-22 21:55:40', model: 'qwen2.5-coder:7b', mode: 'instant', query: 'Build a Docker compose for a Python ML inference stack', response: 'Here is a production-ready docker-compose.yml...', status: 'success', latency: '1.09s', tokens: 448 },
  { id: 'req-012', ip: '10.0.0.5', ts: '2026-04-22 20:03:27', model: 'deepseek-r1:14b', mode: 'expert', query: 'Explain the difference between RLHF and DPO training', response: '', status: 'streaming', latency: '—', tokens: 234 },
];

const STATUS_CONFIG = {
  success: { label: 'SUCCESS', cls: 'text-ttd-green border-ttd-green/30 bg-ttd-green/5' },
  error: { label: 'ERROR', cls: 'text-ttd-red border-ttd-red/30 bg-ttd-red/5' },
  timeout: { label: 'TIMEOUT', cls: 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5' },
  streaming: { label: 'STREAMING', cls: 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5' },
};

export default function AdminRequestsTab() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const perPage = 8;

  const filtered = REQUESTS.filter(r => {
    const matchSearch = r.ip.includes(search) || r.query.toLowerCase().includes(search.toLowerCase()) || r.model.includes(search);
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    toast.success(`Exported ${filtered.length} records as CSV`);
  };

  const counts = {
    total: REQUESTS.length,
    success: REQUESTS.filter(r => r.status === 'success').length,
    error: REQUESTS.filter(r => r.status === 'error').length,
    timeout: REQUESTS.filter(r => r.status === 'timeout').length,
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'TOTAL REQUESTS', value: counts.total, color: 'text-ttd-text' },
          { label: 'SUCCESS', value: counts.success, color: 'text-ttd-green' },
          { label: 'ERRORS', value: counts.error, color: 'text-ttd-red' },
          { label: 'TIMEOUTS', value: counts.timeout, color: 'text-ttd-amber' },
        ].map((stat) => (
          <div key={`stat-${stat.label}`} className="bg-ttd-surface border border-ttd-border rounded-sm px-4 py-3">
            <div className="text-[10px] text-ttd-muted tracking-wider mb-1">{stat.label}</div>
            <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ttd-dim" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="search IP, query, model..."
            className="ttd-input text-xs py-2 pl-8"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'success', 'error', 'timeout', 'streaming'] as const).map((s) => (
            <button
              key={`filter-${s}`}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`ttd-btn px-3 py-1 text-[10px] ${
                statusFilter === s
                  ? s === 'all' ? 'ttd-btn-cyan' : s === 'success' ? 'ttd-btn-green' : s === 'error' ? 'ttd-btn-red' : 'ttd-btn-ghost' :'ttd-btn-ghost'
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={handleExport} className="ttd-btn ttd-btn-ghost text-xs flex items-center gap-1.5 px-3 py-1">
          <Download size={11} />
          EXPORT
        </button>
      </div>

      {/* Table */}
      <div className="border border-ttd-border rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ttd-border bg-ttd-elevated">
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold w-8" />
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">IP</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">TIMESTAMP</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">MODEL</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">MODE</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">QUERY</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">STATUS</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">LATENCY</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">TOKENS</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((req, i) => (
                <React.Fragment key={req.id}>
                  <tr
                    className={`border-b border-ttd-border/50 hover:bg-ttd-elevated/50 transition-colors cursor-pointer ${
                      i % 2 === 0 ? '' : 'bg-ttd-surface/30'
                    } ${expandedRows.has(req.id) ? 'bg-ttd-elevated/30' : ''}`}
                    onClick={() => (req.errorDetails || req.response) && toggleRow(req.id)}
                  >
                    <td className="px-3 py-2.5">
                      {(req.errorDetails || req.response) && (
                        expandedRows.has(req.id)
                          ? <ChevronDown size={12} className="text-ttd-muted" />
                          : <ChevronRight size={12} className="text-ttd-muted" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono-data text-ttd-cyan">{req.ip}</td>
                    <td className="px-3 py-2.5 text-ttd-muted whitespace-nowrap">{req.ts}</td>
                    <td className="px-3 py-2.5 text-ttd-text whitespace-nowrap">{req.model}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${
                        req.mode === 'expert' ? 'text-ttd-green border-ttd-green/30' : 'text-ttd-cyan border-ttd-cyan/30'
                      }`}>
                        {req.mode.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 max-w-xs">
                      <span className="text-ttd-text truncate block max-w-[200px]" title={req.query}>
                        {req.query.length > 50 ? req.query.slice(0, 50) + '...' : req.query}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded-sm ${STATUS_CONFIG[req.status].cls}`}>
                        {STATUS_CONFIG[req.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono-data text-ttd-muted whitespace-nowrap">{req.latency}</td>
                    <td className="px-3 py-2.5 font-mono-data text-ttd-muted">{req.tokens > 0 ? req.tokens : '—'}</td>
                  </tr>
                  {expandedRows.has(req.id) && (
                    <tr key={`${req.id}-expanded`} className="border-b border-ttd-border">
                      <td colSpan={9} className="px-6 py-4 bg-ttd-card">
                        {req.errorDetails && (
                          <div className="mb-3">
                            <div className="text-[10px] text-ttd-red tracking-wider mb-1.5 font-semibold">── ERROR DETAILS ──</div>
                            <div className="bg-ttd-elevated border border-ttd-red/20 rounded-sm px-3 py-2 text-xs text-ttd-red/80 font-mono">
                              {req.errorDetails}
                            </div>
                          </div>
                        )}
                        {req.response && (
                          <div>
                            <div className="text-[10px] text-ttd-muted tracking-wider mb-1.5 font-semibold">── RESPONSE PREVIEW ──</div>
                            <div className="bg-ttd-elevated border border-ttd-border rounded-sm px-3 py-2 text-xs text-ttd-text/70 font-mono line-clamp-4">
                              {req.response}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-[11px] text-ttd-muted">
          Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} requests
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="ttd-btn ttd-btn-ghost px-3 py-1 text-xs disabled:opacity-30"
          >
            ← PREV
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={`page-${p}`}
              onClick={() => setPage(p)}
              className={`ttd-btn px-2.5 py-1 text-xs ${page === p ? 'ttd-btn-green' : 'ttd-btn-ghost'}`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="ttd-btn ttd-btn-ghost px-3 py-1 text-xs disabled:opacity-30"
          >
            NEXT →
          </button>
        </div>
      </div>
    </div>
  );
}