'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, ArrowLeft, Lock } from 'lucide-react';
import { toast } from 'sonner';
import AdminRequestsTab from './AdminRequestsTab';
import AdminServerTab from './AdminServerTab';
import AdminModelsTab from './AdminModelsTab';
import AdminSessionsTab from './AdminSessionsTab';
import { clearAdminToken, getAdminToken, postJson, setAdminToken } from '@/lib/api';

type Tab = 'requests' | 'server' | 'models' | 'sessions';

interface LoginResponse {
  ok: boolean;
  token: string;
  mustChangePassword?: boolean;
  session: {
    ip: string;
    loginTime: string;
  };
}

const ASCII_ADMIN = `
 ▄▄▄  ██▄  ██▄▄▄▄▄██ ██▄▄▄▄▄
 ██   ██ █  ██  ██  █ ██  ██  
 ██▄▄ ██ █  ██  ██  █ ██  ██  
 ██   ████  ██  ██  █ ██  ██  
 ▀▀▀  ██ ▀▀ ██  ██  █ ██  ██  `;

export default function AdminPanelClient() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [sessionIp, setSessionIp] = useState('127.0.0.1');
  const [sessionTime, setSessionTime] = useState('');

  useEffect(() => {
    if (getAdminToken()) setAuthed(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = await postJson<LoginResponse>('/admin/login', { password });
      setAdminToken(payload.token);
      setAuthed(true);
      setPwError('');
      setSessionIp(payload.session.ip);
      setSessionTime(payload.session.loginTime);
      toast.success(`Admin session started · IP: ${payload.session.ip}`);
      if (payload.mustChangePassword) {
        toast.warning('Default admin password is still active. Change it in Sessions.');
      }
    } catch (error) {
      setLoginAttempts(prev => prev + 1);
      setPwError(`Invalid credentials (attempt ${loginAttempts + 1})`);
      setPassword('');
      toast.error(error instanceof Error ? error.message : 'Authentication failed');
    }
  };

  const handleLogout = async () => {
    try {
      await postJson('/admin/logout', {}, true);
    } catch {
      // Token may already be dead; clear it locally anyway.
    }
    clearAdminToken();
    setAuthed(false);
    setPassword('');
    toast('Admin session ended');
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-ttd-bg flex flex-col items-center justify-center px-4">
        <div className="pointer-events-none fixed inset-0 z-0" style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)'
        }} />

        <div className="w-full max-w-sm relative z-10">
          {/* ASCII header */}
          <div className="text-center mb-8">
            <pre className="ascii-text text-ttd-red text-[7px] leading-tight select-none"
              style={{ textShadow: '0 0 12px rgba(255,68,68,0.4)' }}>
              {ASCII_ADMIN}
            </pre>
            <div className="mt-3 text-ttd-muted text-xs tracking-widest">// RESTRICTED ACCESS //</div>
          </div>

          <div className="bg-ttd-surface border border-ttd-border rounded-sm p-6">
            <div className="flex items-center gap-2 mb-6">
              <Shield size={16} className="text-ttd-red" />
              <span className="text-sm font-bold tracking-wider text-ttd-text">ADMIN AUTHENTICATION</span>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] text-ttd-muted mb-1.5 tracking-wider uppercase">
                  Admin Password
                </label>
                <div className="relative">
                  <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ttd-dim" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPwError(''); }}
                    placeholder="enter admin password"
                    className="ttd-input pl-9"
                    autoFocus
                  />
                </div>
                {pwError && (
                  <p className="text-[11px] text-ttd-red mt-1.5 flex items-center gap-1">
                    <span>▶</span> {pwError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="ttd-btn ttd-btn-red w-full py-2.5 text-sm tracking-widest"
              >
                AUTHENTICATE
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-ttd-border">
              <div className="text-[10px] text-ttd-dim text-center">Password is configured on the backend</div>
            </div>
          </div>

          <button
            onClick={() => router.push('/chat-interface')}
            className="mt-4 flex items-center gap-2 text-ttd-muted text-xs hover:text-ttd-text transition-colors mx-auto"
          >
            <ArrowLeft size={12} />
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; badge?: string }[] = [
    { id: 'requests', label: 'REQUEST DB' },
    { id: 'server', label: 'SERVER LOAD' },
    { id: 'models', label: 'MODELS' },
    { id: 'sessions', label: 'SESSIONS' },
  ];

  return (
    <div className="min-h-screen bg-ttd-bg flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)'
      }} />

      {/* Admin header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-ttd-border bg-ttd-surface/80 backdrop-blur-sm sticky top-0 z-40">
        <button
          onClick={() => router.push('/chat-interface')}
          className="flex items-center gap-1.5 text-ttd-muted hover:text-ttd-text transition-colors text-xs"
        >
          <ArrowLeft size={13} />
          CHAT
        </button>
        <div className="w-px h-4 bg-ttd-border" />
        <Shield size={14} className="text-ttd-red" />
        <span className="text-sm font-bold tracking-widest text-ttd-red">ADMIN PANEL</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-green" />
            <span className="text-[10px] text-ttd-muted">session active · {sessionIp}</span>
          </div>
          <span className="text-[10px] text-ttd-dim">{sessionTime || 'active'}</span>
          <button
            onClick={handleLogout}
            className="ttd-btn ttd-btn-red px-3 py-1 text-xs"
          >
            LOGOUT
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 px-6 border-b border-ttd-border bg-ttd-surface/50 sticky top-[49px] z-30">
        {TABS.map((tab) => (
          <button
            key={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-xs font-semibold tracking-wider transition-all ${
              activeTab === tab.id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className="ml-2 text-[9px] bg-ttd-red/20 text-ttd-red border border-ttd-red/30 px-1 py-0.5 rounded-sm">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 relative z-10">
        {activeTab === 'requests' && <AdminRequestsTab />}
        {activeTab === 'server' && <AdminServerTab />}
        {activeTab === 'models' && <AdminModelsTab />}
        {activeTab === 'sessions' && <AdminSessionsTab />}
      </div>
    </div>
  );
}
