'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { UserX, Key, ChevronDown, ChevronRight, Shield, LogOut } from 'lucide-react';
import { getJson, postJson } from '@/lib/api';

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

interface SessionsResponse {
  ok: boolean;
  sessions: AdminSession[];
}

export default function AdminSessionsTab() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [kickConfirm, setKickConfirm] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PasswordForm>();
  const newPw = watch('newPassword');

  const loadSessions = () => {
    getJson<SessionsResponse>('/admin/sessions', true)
      .then(payload => setSessions(payload.sessions))
      .catch((error: Error) => toast.error(error.message));
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleKickAll = async () => {
    try {
      await postJson('/admin/kick-all', {}, true);
      setKickConfirm(false);
      loadSessions();
      toast.success('All active sessions terminated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kick failed');
    }
  };

  const onChangePassword = async (data: PasswordForm) => {
    try {
      await postJson('/admin/change-password', data, true);
      toast.success('Admin password updated successfully');
      setShowPasswordForm(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password update failed');
    }
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
