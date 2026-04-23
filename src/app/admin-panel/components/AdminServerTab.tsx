'use client';

import React, { useEffect, useState } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity } from 'lucide-react';
import { getJson } from '@/lib/api';

type Interval = '1min' | '30min' | '1hr' | '1day' | '1week';

interface ProcessEntry {
  id: string;
  name: string;
  pid: number;
  status: string;
  vram: string;
  cpu: string;
  threads: number;
  uptime: string;
}

interface CurrentStats {
  cpu: number;
  ram: number;
  gpu: number;
  vram: number;
  temp: number;
  fanRpm: number;
  totalVram: string;
  usedVram: string;
  totalRam: string;
  usedRam: string;
}

interface SystemResponse {
  ok: boolean;
  current: CurrentStats;
  history: Array<{ t: string; cpu: number; ram: number; gpu: number; vram: number; tps: number }>;
  processes: ProcessEntry[];
  system: Array<{ label: string; value: string }>;
}

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
    cpu: 0,
    ram: 0,
    gpu: 0,
    vram: 0,
    tps: 0,
  }));
}

const CURRENT_STATS = {
  cpu: 0,
  ram: 0,
  gpu: 0,
  vram: 0,
  temp: 0,
  fanRpm: 0,
  totalVram: '-',
  usedVram: '-',
  totalRam: '-',
  usedRam: '-',
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
  const [data, setData] = useState(generateTimeData('30min'));
  const [currentStats, setCurrentStats] = useState(CURRENT_STATS);
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [systemInfo, setSystemInfo] = useState<Array<{ label: string; value: string }>>([
    { label: 'GPU', value: 'not detected by backend' },
    { label: 'CPU', value: 'loading' },
    { label: 'RAM', value: 'loading' },
    { label: 'Python', value: 'loading' },
  ]);

  const INTERVALS: Interval[] = ['1min', '30min', '1hr', '1day', '1week'];

  useEffect(() => {
    getJson<SystemResponse>(`/admin/server?interval=${interval}`, true)
      .then((payload) => {
        setData(payload.history);
        setCurrentStats(payload.current);
        setProcesses(payload.processes);
        setSystemInfo(payload.system);
      })
      .catch(() => undefined);
  }, [interval]);

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Left: charts */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Current stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'CPU', value: currentStats.cpu, detail: 'host CPU', color: 'text-ttd-cyan', fill: 'progress-bar-fill-cyan' },
              { label: 'RAM', value: currentStats.ram, detail: `${currentStats.usedRam} / ${currentStats.totalRam}`, color: 'text-ttd-green', fill: 'progress-bar-fill-green' },
              { label: 'GPU', value: currentStats.gpu, detail: currentStats.temp ? `GPU · ${currentStats.temp}°C` : 'GPU telemetry unavailable', color: 'text-ttd-amber', fill: 'progress-bar-fill-amber' },
              { label: 'VRAM', value: currentStats.vram, detail: `${currentStats.usedVram} / ${currentStats.totalVram}`, color: currentStats.vram > 85 ? 'text-ttd-red' : 'text-ttd-purple', fill: currentStats.vram > 85 ? 'progress-bar-fill-red' : 'progress-bar-fill-amber' },
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
              <span className="ml-auto text-[10px] text-ttd-muted">{processes.length} running</span>
            </div>
            <div className="divide-y divide-ttd-border/50">
              {processes.map((proc) => (
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
              {systemInfo.map((item) => (
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
