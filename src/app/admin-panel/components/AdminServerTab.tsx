'use client';

import React, { useState } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity } from 'lucide-react';

type Interval = '1min' | '30min' | '1hr' | '1day' | '1week';

function generateTimeData(interval: Interval) {
  const points = interval === '1min' ? 60 : interval === '30min' ? 30 : interval === '1hr' ? 60 : interval === '1day' ? 24 : 7;
  const labelFn = (i: number): string => {
    if (interval === '1min') return `${i}s`;
    if (interval === '30min') return `${i}m`;
    if (interval === '1hr') return `${i}m`;
    if (interval === '1day') return `${i}:00`;
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] || `D${i}`;
  };

  return Array.from({ length: points }, (_, i) => ({
    t: labelFn(i),
    cpu: Math.max(5, Math.min(95, 30 + Math.sin(i * 0.3) * 25 + Math.random() * 15)),
    ram: Math.max(20, Math.min(90, 55 + Math.sin(i * 0.15) * 20 + Math.random() * 8)),
    gpu: Math.max(0, Math.min(100, 40 + Math.sin(i * 0.4 + 1) * 35 + Math.random() * 12)),
    vram: Math.max(10, Math.min(95, 62 + Math.sin(i * 0.2) * 18 + Math.random() * 6)),
    tps: Math.max(0, Math.min(80, 28 + Math.sin(i * 0.5) * 22 + Math.random() * 10)),
  }));
}

const ACTIVE_PROCESSES = [
  { id: 'proc-001', name: 'deepseek-r1:14b', pid: 12847, status: 'active', vram: '9.2GB', cpu: '38%', threads: 16, uptime: '2h 14m' },
  { id: 'proc-002', name: 'qwen2.5-coder:7b', pid: 13201, status: 'idle', vram: '5.1GB', cpu: '0.2%', threads: 8, uptime: '2h 14m' },
  { id: 'proc-003', name: 'flux-dev', pid: 13589, status: 'idle', vram: '7.8GB', cpu: '0.1%', threads: 12, uptime: '1h 47m' },
  { id: 'proc-004', name: 'ttd-api-server', pid: 9102, status: 'active', vram: '—', cpu: '1.4%', threads: 4, uptime: '4h 02m' },
  { id: 'proc-005', name: 'mysql-daemon', pid: 8844, status: 'active', vram: '—', cpu: '0.8%', threads: 2, uptime: '4h 02m' },
];

const CURRENT_STATS = {
  cpu: 42,
  ram: 67,
  gpu: 55,
  vram: 72,
  temp: 71,
  fanRpm: 2340,
  totalVram: '24GB',
  usedVram: '17.3GB',
  totalRam: '64GB',
  usedRam: '42.9GB',
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-ttd-surface border border-ttd-border rounded-sm px-3 py-2 text-xs shadow-xl">
      <div className="text-ttd-muted mb-1.5 text-[10px]">{label}</div>
      {payload.map((p) => (
        <div key={`tip-${p.name}`} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-ttd-muted">{p.name}:</span>
          <span className="font-semibold" style={{ color: p.color }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}%</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminServerTab() {
  const [interval, setInterval] = useState<Interval>('30min');
  const data = generateTimeData(interval);

  const INTERVALS: Interval[] = ['1min', '30min', '1hr', '1day', '1week'];

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Left: charts */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Current stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'CPU', value: CURRENT_STATS.cpu, detail: '16 cores · 5.2GHz', color: 'text-ttd-cyan', fill: 'progress-bar-fill-cyan' },
              { label: 'RAM', value: CURRENT_STATS.ram, detail: `${CURRENT_STATS.usedRam} / ${CURRENT_STATS.totalRam}`, color: 'text-ttd-green', fill: 'progress-bar-fill-green' },
              { label: 'GPU', value: CURRENT_STATS.gpu, detail: 'RTX 4090 · 71°C', color: 'text-ttd-amber', fill: 'progress-bar-fill-amber' },
              { label: 'VRAM', value: CURRENT_STATS.vram, detail: `${CURRENT_STATS.usedVram} / ${CURRENT_STATS.totalVram}`, color: CURRENT_STATS.vram > 85 ? 'text-ttd-red' : 'text-ttd-purple', fill: CURRENT_STATS.vram > 85 ? 'progress-bar-fill-red' : 'progress-bar-fill-amber' },
            ].map((stat) => (
              <div key={`stat-${stat.label}`} className="bg-ttd-surface border border-ttd-border rounded-sm px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-ttd-muted tracking-wider">{stat.label}</span>
                  <span className={`text-xl font-bold tabular-nums ${stat.color}`}>{stat.value}%</span>
                </div>
                <div className="progress-bar-track">
                  <div className={stat.fill} style={{ width: `${stat.value}%` }} />
                </div>
                <div className="text-[10px] text-ttd-dim mt-1.5">{stat.detail}</div>
              </div>
            ))}
          </div>

          {/* Interval selector */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ttd-muted tracking-wider">── HISTORICAL LOAD ──</span>
            <div className="flex items-center gap-1">
              {INTERVALS.map((iv) => (
                <button
                  key={`iv-${iv}`}
                  onClick={() => setInterval(iv)}
                  className={`ttd-btn px-3 py-1 text-[10px] ${interval === iv ? 'ttd-btn-cyan' : 'ttd-btn-ghost'}`}
                >
                  {iv}
                </button>
              ))}
            </div>
          </div>

          {/* CPU + RAM chart */}
          <div className="bg-ttd-surface border border-ttd-border rounded-sm p-4">
            <div className="text-xs text-ttd-muted mb-4 tracking-wider">CPU & RAM UTILIZATION</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ccff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00ccff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradRam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff88" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <YAxis tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="cpu" name="CPU" stroke="#00ccff" fill="url(#gradCpu)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="ram" name="RAM" stroke="#00ff88" fill="url(#gradRam)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* GPU + VRAM chart */}
          <div className="bg-ttd-surface border border-ttd-border rounded-sm p-4">
            <div className="text-xs text-ttd-muted mb-4 tracking-wider">GPU UTILIZATION & VRAM</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradGpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffaa00" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ffaa00" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradVram" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#aa88ff" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#aa88ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <YAxis tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="gpu" name="GPU" stroke="#ffaa00" fill="url(#gradGpu)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="vram" name="VRAM" stroke="#aa88ff" fill="url(#gradVram)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Tokens/sec chart */}
          <div className="bg-ttd-surface border border-ttd-border rounded-sm p-4">
            <div className="text-xs text-ttd-muted mb-4 tracking-wider">TOKEN THROUGHPUT (tok/s)</div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <YAxis tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono' }} domain={[0, 80]} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="tps" name="tok/s" stroke="#00ff88" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: active processes */}
        <div className="w-full xl:w-80 flex-shrink-0 space-y-4">
          <div className="bg-ttd-surface border border-ttd-border rounded-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-ttd-border flex items-center gap-2">
              <Activity size={13} className="text-ttd-green" />
              <span className="text-xs font-bold tracking-wider text-ttd-text">ACTIVE PROCESSES</span>
              <span className="ml-auto text-[10px] text-ttd-muted">{ACTIVE_PROCESSES.length} running</span>
            </div>
            <div className="divide-y divide-ttd-border/50">
              {ACTIVE_PROCESSES.map((proc) => (
                <div key={proc.id} className="px-4 py-3 hover:bg-ttd-elevated transition-colors">
                  <div className="flex items-start justify-between mb-1.5">
                    <div>
                      <div className="text-xs text-ttd-text font-semibold">{proc.name}</div>
                      <div className="text-[10px] text-ttd-dim">PID {proc.pid} · {proc.threads} threads</div>
                    </div>
                    <span className={`text-[9px] border px-1.5 py-0.5 rounded-sm ${
                      proc.status === 'active' ?'text-ttd-green border-ttd-green/30 bg-ttd-green/5' :'text-ttd-muted border-ttd-border'
                    }`}>
                      {proc.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-ttd-dim">CPU</span>
                      <div className="text-ttd-cyan font-mono">{proc.cpu}</div>
                    </div>
                    <div>
                      <span className="text-ttd-dim">VRAM</span>
                      <div className="text-ttd-purple font-mono">{proc.vram}</div>
                    </div>
                    <div>
                      <span className="text-ttd-dim">UPTIME</span>
                      <div className="text-ttd-muted font-mono">{proc.uptime}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* System info */}
          <div className="bg-ttd-surface border border-ttd-border rounded-sm p-4">
            <div className="text-[10px] text-ttd-muted tracking-wider mb-3">── SYSTEM INFO ──</div>
            <div className="space-y-2 text-xs">
              {[
                { label: 'GPU', value: 'NVIDIA RTX 4090 24GB' },
                { label: 'CPU', value: 'AMD Ryzen 9 7950X' },
                { label: 'RAM', value: '64GB DDR5-6000' },
                { label: 'OS', value: 'Ubuntu 24.04 LTS' },
                { label: 'CUDA', value: '12.4 · Driver 550.54' },
                { label: 'Python', value: '3.12.3' },
                { label: 'GPU Temp', value: `${CURRENT_STATS.temp}°C` },
                { label: 'Fan', value: `${CURRENT_STATS.fanRpm} RPM` },
              ].map((item) => (
                <div key={`info-${item.label}`} className="flex items-center justify-between">
                  <span className="text-ttd-muted text-[10px]">{item.label}</span>
                  <span className="text-ttd-text text-[10px] font-mono text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}