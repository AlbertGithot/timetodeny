'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { UserX, Key, ChevronDown, ChevronRight, Shield, LogOut } from 'lucide-react';

interface AdminSession {
  id: string;
  ip: string;
  loginTime: string;
  logoutTime: string | null;
  status: 'active' | 'ended';
  actions: string[];
  userAgent: string;
}

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const SESSIONS: AdminSession[] = [
  {
    id: 'sess-001',
    ip: '127.0.0.1',
    loginTime: '2026-04-23 11:35:58',
    logoutTime: null,
    status: 'active',
    userAgent: 'Mozilla/5.0 · Chrome 124 · Linux',
    actions: [
      '11:35:58 — Authenticated successfully',
      '11:36:12 — Viewed Request Database tab',
      '11:36:45 — Viewed Server Load tab',
      '11:37:02 — Viewed Models tab',
      '11:37:30 — Updated system prompt for deepseek-r1:14b',
      '11:38:01 — Viewed Sessions tab',
    ],
  },
  {
    id: 'sess-002',
    ip: '192.168.1.44',
    loginTime: '2026-04-23 09:02:11',
    logoutTime: '2026-04-23 10:58:33',
    status: 'ended',
    userAgent: 'Mozilla/5.0 · Firefox 125 · Windows 11',
    actions: [
      '09:02:11 — Authenticated successfully',
      '09:02:30 — Viewed Request Database tab',
      '09:15:44 — Installed model: phi-4-q4.gguf',
      '09:44:02 — Deleted model: mistral-7b-v0.3',
      '10:58:33 — Session ended (logout)',
    ],
  },
  {
    id: 'sess-003',
    ip: '10.0.0.2',
    loginTime: '2026-04-22 22:10:05',
    logoutTime: '2026-04-22 23:02:18',
    status: 'ended',
    userAgent: 'Mozilla/5.0 · Safari 17 · macOS',
    actions: [
      '22:10:05 — Authenticated successfully',
      '22:10:22 — Viewed Server Load tab',
      '22:31:09 — Changed admin password',
      '23:02:18 — Session ended (timeout)',
    ],
  },
  {
    id: 'sess-004',
    ip: '10.0.0.5',
    loginTime: '2026-04-22 14:30:00',
    logoutTime: '2026-04-22 15:11:47',
    status: 'ended',
    userAgent: 'Mozilla/5.0 · Chrome 124 · Ubuntu',
    actions: [
      '14:30:00 — Authenticated successfully',
      '14:30:18 — Viewed Models tab',
      '14:31:02 — Selected qwen2.5-coder:7b for responses',
      '14:55:30 — Kicked all active sessions',
      '15:11:47 — Session ended (logout)',
    ],
  },
];

export default function AdminSessionsTab() {
  const [sessions, setSessions] = useState<AdminSession[]>(SESSIONS);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [kickConfirm, setKickConfirm] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PasswordForm>();
  const newPw = watch('newPassword');

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleKickAll = () => {
    setSessions(prev => prev.map(s =>
      s.status === 'active'
        ? { ...s, status: 'ended', logoutTime: new Date().toISOString().slice(0, 19).replace('T', ' ') }
        : s
    ));
    setKickConfirm(false);
    toast.success('All active sessions terminated');
  };

  const onChangePassword = (data: PasswordForm) => {
    // TODO: Backend integration — POST /api/admin/change-password with { currentPassword, newPassword }
    if (data.currentPassword !== '1111') {
      toast.error('Current password incorrect');
      return;
    }
    toast.success('Admin password updated successfully');
    setShowPasswordForm(false);
    reset();
  };

  const activeSessions = sessions.filter(s => s.status === 'active');
  const endedSessions = sessions.filter(s => s.status === 'ended');

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'ACTIVE SESSIONS', value: activeSessions.length, color: activeSessions.length > 0 ? 'text-ttd-green' : 'text-ttd-muted' },
          { label: 'TOTAL SESSIONS', value: sessions.length, color: 'text-ttd-text' },
          { label: 'UNIQUE IPs', value: new Set(sessions.map(s => s.ip)).size, color: 'text-ttd-cyan' },
          { label: 'ENDED', value: endedSessions.length, color: 'text-ttd-muted' },
        ].map((stat) => (
          <div key={`sess-stat-${stat.label}`} className="bg-ttd-surface border border-ttd-border rounded-sm px-4 py-3">
            <div className="text-[10px] text-ttd-muted tracking-wider mb-1">{stat.label}</div>
            <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setKickConfirm(true)}
          disabled={activeSessions.length === 0}
          className="ttd-btn ttd-btn-red flex items-center gap-2 px-4 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UserX size={13} />
          KICK ALL SESSIONS ({activeSessions.length})
        </button>
        <button
          onClick={() => setShowPasswordForm(!showPasswordForm)}
          className="ttd-btn ttd-btn-cyan flex items-center gap-2 px-4 py-2 text-xs"
        >
          <Key size={13} />
          CHANGE PASSWORD
        </button>
      </div>

      {/* Change password form */}
      {showPasswordForm && (
        <div className="bg-ttd-surface border border-ttd-border rounded-sm p-5 animate-fade-in max-w-md">
          <div className="flex items-center gap-2 mb-4">
            <Key size={14} className="text-ttd-cyan" />
            <span className="text-xs font-bold tracking-wider text-ttd-text">CHANGE ADMIN PASSWORD</span>
          </div>
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-4">
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">Current Password</label>
              <input
                type="password"
                {...register('currentPassword', { required: 'Current password is required' })}
                className="ttd-input text-xs"
                placeholder="current password"
              />
              {errors.currentPassword && <p className="text-[10px] text-ttd-red mt-1">{errors.currentPassword.message}</p>}
            </div>
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">New Password</label>
              <input
                type="password"
                {...register('newPassword', { required: 'New password is required', minLength: { value: 4, message: 'Minimum 4 characters' } })}
                className="ttd-input text-xs"
                placeholder="new password"
              />
              {errors.newPassword && <p className="text-[10px] text-ttd-red mt-1">{errors.newPassword.message}</p>}
            </div>
            <div>
              <label className="block text-[10px] text-ttd-muted tracking-wider mb-1.5 uppercase">Confirm New Password</label>
              <input
                type="password"
                {...register('confirmPassword', {
                  required: 'Please confirm your password',
                  validate: v => v === newPw || 'Passwords do not match',
                })}
                className="ttd-input text-xs"
                placeholder="confirm new password"
              />
              {errors.confirmPassword && <p className="text-[10px] text-ttd-red mt-1">{errors.confirmPassword.message}</p>}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" className="ttd-btn ttd-btn-cyan flex-1 py-2 text-xs">UPDATE PASSWORD</button>
              <button type="button" onClick={() => { setShowPasswordForm(false); reset(); }} className="ttd-btn ttd-btn-ghost flex-1 py-2 text-xs">CANCEL</button>
            </div>
          </form>
        </div>
      )}

      {/* Sessions table */}
      <div className="border border-ttd-border rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ttd-border bg-ttd-elevated flex items-center gap-2">
          <Shield size={13} className="text-ttd-muted" />
          <span className="text-xs font-bold tracking-wider text-ttd-text">SESSION LOG</span>
          <span className="ml-auto text-[10px] text-ttd-muted">{sessions.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ttd-border bg-ttd-elevated/50">
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold w-8" />
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">IP ADDRESS</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">LOGIN TIME</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">LOGOUT TIME</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">STATUS</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">USER AGENT</th>
                <th className="text-left px-3 py-2.5 text-ttd-muted tracking-wider font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((sess, i) => (
                <React.Fragment key={sess.id}>
                  <tr
                    className={`border-b border-ttd-border/50 hover:bg-ttd-elevated/50 transition-colors cursor-pointer ${
                      i % 2 === 0 ? '' : 'bg-ttd-surface/30'
                    } ${sess.status === 'active' ? 'bg-ttd-green/3' : ''}`}
                    onClick={() => toggleRow(sess.id)}
                  >
                    <td className="px-3 py-2.5">
                      {expandedRows.has(sess.id)
                        ? <ChevronDown size={12} className="text-ttd-muted" />
                        : <ChevronRight size={12} className="text-ttd-muted" />}
                    </td>
                    <td className="px-3 py-2.5 font-mono-data text-ttd-cyan">{sess.ip}</td>
                    <td className="px-3 py-2.5 text-ttd-muted whitespace-nowrap">{sess.loginTime}</td>
                    <td className="px-3 py-2.5 text-ttd-muted whitespace-nowrap">
                      {sess.logoutTime ?? <span className="text-ttd-green">— active —</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`status-dot ${sess.status === 'active' ? 'status-dot-green' : 'status-dot-dim'}`} />
                        <span className={`text-[10px] ${sess.status === 'active' ? 'text-ttd-green' : 'text-ttd-muted'}`}>
                          {sess.status.toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ttd-dim max-w-[180px] truncate text-[10px]" title={sess.userAgent}>
                      {sess.userAgent}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] text-ttd-muted border border-ttd-border px-1.5 py-0.5 rounded-sm">
                        {sess.actions.length} actions
                      </span>
                    </td>
                  </tr>
                  {expandedRows.has(sess.id) && (
                    <tr key={`${sess.id}-log`} className="border-b border-ttd-border">
                      <td colSpan={7} className="px-6 py-4 bg-ttd-card">
                        <div className="text-[10px] text-ttd-muted tracking-wider mb-2 font-semibold">── ACTIONS LOG ──</div>
                        <div className="space-y-1">
                          {sess.actions.map((action, ai) => (
                            <div key={`${sess.id}-action-${ai}`} className="flex items-start gap-2 text-[11px]">
                              <span className="text-ttd-dim flex-shrink-0">▶</span>
                              <span className={
                                action.includes('Authenticated') ? 'text-ttd-green' :
                                action.includes('Deleted') || action.includes('Kicked') ? 'text-ttd-red' :
                                action.includes('password') ? 'text-ttd-amber' :
                                'text-ttd-muted'
                              }>
                                {action}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Kick confirm modal */}
      {kickConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-ttd-surface border border-ttd-red/40 rounded-sm p-6 w-full max-w-sm animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <UserX size={16} className="text-ttd-red" />
              <span className="text-sm font-bold text-ttd-red tracking-wider">KICK ALL SESSIONS</span>
            </div>
            <p className="text-xs text-ttd-muted mb-2">
              Terminate all <span className="text-ttd-text font-semibold">{activeSessions.length} active session(s)</span>?
            </p>
            <p className="text-[11px] text-ttd-dim mb-5">
              All connected admin users will be immediately logged out. This action is logged.
            </p>
            <div className="flex gap-3">
              <button onClick={handleKickAll} className="ttd-btn ttd-btn-red flex-1 py-2 text-xs flex items-center justify-center gap-2">
                <LogOut size={12} />
                KICK ALL
              </button>
              <button onClick={() => setKickConfirm(false)} className="ttd-btn ttd-btn-ghost flex-1 py-2 text-xs">
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}