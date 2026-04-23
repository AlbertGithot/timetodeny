'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Download } from 'lucide-react';
import { toast } from 'sonner';
import { apiUrl, authHeaders, getJson } from '@/lib/api';

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

const STATUS_CONFIG = {
  success: { label: 'SUCCESS', cls: 'text-ttd-green border-ttd-green/30 bg-ttd-green/5' },
  error: { label: 'ERROR', cls: 'text-ttd-red border-ttd-red/30 bg-ttd-red/5' },
  timeout: { label: 'TIMEOUT', cls: 'text-ttd-amber border-ttd-amber/30 bg-ttd-amber/5' },
  streaming: { label: 'STREAMING', cls: 'text-ttd-cyan border-ttd-cyan/30 bg-ttd-cyan/5' },
};

interface RequestsResponse {
  ok: boolean;
  requests: RequestEntry[];
}

export default function AdminRequestsTab() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const perPage = 8;

  useEffect(() => {
    getJson<RequestsResponse>('/admin/requests', true)
      .then(payload => setRequests(payload.requests))
      .catch((error: Error) => toast.error(error.message));
  }, []);

  const filtered = requests.filter(r => {
    const matchSearch = r.ip.includes(search) || r.query.toLowerCase().includes(search.toLowerCase()) || r.model.includes(search);
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const showingStart = filtered.length === 0 ? 0 : (page - 1) * perPage + 1;

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    fetch(apiUrl('/admin/requests/export'), { headers: authHeaders() })
      .then((response) => {
        if (!response.ok) throw new Error('Export failed');
        return response.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ttd_requests.csv';
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${filtered.length} records as CSV`);
      })
      .catch((error: Error) => toast.error(error.message));
  };

  const counts = {
    total: requests.length,
    success: requests.filter(r => r.status === 'success').length,
    error: requests.filter(r => r.status === 'error').length,
    timeout: requests.filter(r => r.status === 'timeout').length,
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
          Showing {showingStart}–{Math.min(page * perPage, filtered.length)} of {filtered.length} requests
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
