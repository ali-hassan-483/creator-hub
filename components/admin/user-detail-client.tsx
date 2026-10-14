'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Server, Globe, Tv, Zap, DollarSign,
  Shield, Key, Lock, Eye, EyeOff, CheckCircle2,
  XCircle, Trash2, ArrowUpRight, ArrowDownRight, RefreshCw,
  Clock, Activity, AlertCircle
} from 'lucide-react'

interface UserDetailProps {
  initialUser: any
  availableIps: { id: string; ipAddress: string; label: string | null }[]
}

export function UserDetailClient({ initialUser, availableIps }: UserDetailProps) {
  const router = useRouter()
  const [user, setUser] = useState(initialUser)
  const [activeTab, setActiveTab] = useState<'overview' | 'channels' | 'automations' | 'earnings' | 'settings'>('overview')

  // Password visibility
  const [showVpsPassword, setShowVpsPassword] = useState(false)

  // Status & loading
  const [statusLoading, setStatusLoading] = useState(false)
  const [ipLoading, setIpLoading] = useState(false)
  const [selectedIpId, setSelectedIpId] = useState(user.assignedIp?.id || '')

  // Reset password state
  const [newPassword, setNewPassword] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdMsg, setPwdMsg] = useState('')

  async function handleToggleStatus() {
    setStatusLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      if (res.ok) {
        setUser({ ...user, isActive: !user.isActive })
      }
    } finally {
      setStatusLoading(false)
    }
  }

  async function handleAssignIp(e: React.FormEvent) {
    e.preventDefault()
    setIpLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedIpId: selectedIpId || null }),
      })
      if (res.ok) {
        // Refetch user data
        const updated = await fetch(`/api/admin/users/${user.id}`).then((r) => r.json())
        setUser(updated)
      }
    } finally {
      setIpLoading(false)
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdLoading(true)
    setPwdMsg('')
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      if (res.ok) {
        setPwdMsg('Password updated successfully!')
        setNewPassword('')
      } else {
        const err = await res.json()
        setPwdMsg(err.error || 'Failed to update password')
      }
    } finally {
      setPwdLoading(false)
    }
  }

  async function handleDeleteUser() {
    if (!confirm('Are you sure you want to permanently delete this user account? All their channels and data will be removed.')) {
      return
    }
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/admin/users')
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6">
      {/* Top Breadcrumb & Header */}
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Users List
        </Link>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xl border border-primary/20">
              {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{user.name || 'Unnamed User'}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                  user.isActive
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                }`}>
                  {user.isActive ? 'Active Account' : 'Inactive'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-muted text-muted-foreground uppercase border border-border">
                  {user.role}
                </span>
              </div>
              <p className="text-sm text-muted-foreground font-mono mt-0.5">{user.email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Joined: {new Date(user.createdAt).toLocaleDateString()} · Last Login:{' '}
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleStatus}
              disabled={statusLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                user.isActive
                  ? 'border-rose-500/30 text-rose-600 hover:bg-rose-500/10'
                  : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
              }`}
            >
              {user.isActive ? 'Deactivate User' : 'Activate User'}
            </button>
            <button
              onClick={handleDeleteUser}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              title="Delete User"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 4 Metric Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Channels</span>
            <Tv size={16} className="text-primary" />
          </div>
          <p className="text-2xl font-bold text-foreground">{user.stats.totalChannels}</p>
          <span className="text-xs text-muted-foreground">Active in database</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Added Today</span>
            <ArrowUpRight size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            +{user.stats.channelsAddedToday}
          </p>
          <span className="text-xs text-muted-foreground">New channels added</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Removed Today</span>
            <ArrowDownRight size={16} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600">
            -{user.stats.channelsRemovedToday}
          </p>
          <span className="text-xs text-muted-foreground">Channels detached</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Confirmed Earnings</span>
            <DollarSign size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${user.stats.confirmedEarnings.toFixed(2)}
          </p>
          <span className="text-xs text-muted-foreground">
            Pending: ${user.stats.pendingEarnings.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border flex gap-4 text-sm font-medium">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Assigned VPS / Infrastructure
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'channels'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Channels ({user.channels.length})
        </button>
        <button
          onClick={() => setActiveTab('automations')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'automations'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Automations ({user.automations.length})
        </button>
        <button
          onClick={() => setActiveTab('earnings')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'earnings'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Earnings
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`pb-3 px-1 border-b-2 transition-colors ${
            activeTab === 'settings'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Account & Password Reset
        </button>
      </div>

      {/* TAB 1: Assigned Infrastructure */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 mb-5 border-b border-border">
              <div className="flex items-center gap-3">
                <Server className="text-primary w-5 h-5" />
                <div>
                  <h3 className="text-base font-semibold text-foreground">Dedicated VPS / IP Assignment</h3>
                  <p className="text-xs text-muted-foreground">
                    This user's background processes, browser sessions, and uploads bind to this specific IP.
                  </p>
                </div>
              </div>

              {/* IP Reassign Form */}
              <form onSubmit={handleAssignIp} className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedIpId}
                  onChange={(e) => setSelectedIpId(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No IP (Unassign)</option>
                  {user.assignedIp && (
                    <option value={user.assignedIp.id}>
                      {user.assignedIp.ipAddress} {user.assignedIp.label ? `(${user.assignedIp.label})` : ''} (Current)
                    </option>
                  )}
                  {availableIps
                    .filter((ip) => ip.id !== user.assignedIp?.id)
                    .map((ip) => (
                      <option key={ip.id} value={ip.id}>
                        {ip.ipAddress} {ip.label ? `(${ip.label})` : ''}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  disabled={ipLoading}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {ipLoading ? 'Updating...' : 'Save Assignment'}
                </button>
              </form>
            </div>

            {!user.assignedIp ? (
              <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400 text-xs">
                <AlertCircle size={18} />
                <span>
                  No IP or VPS is currently assigned to this user. Select an available IP from the dropdown above and click "Save Assignment".
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">IP Address</span>
                  <p className="text-sm font-mono font-bold text-foreground mt-1">{user.assignedIp.ipAddress}</p>
                </div>
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">Port</span>
                  <p className="text-sm font-mono text-foreground mt-1">{user.assignedIp.port || 'Default (22)'}</p>
                </div>
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">SSH Username</span>
                  <p className="text-sm font-mono text-foreground mt-1">{user.assignedIp.username || '—'}</p>
                </div>
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">SSH Password</span>
                    <button
                      type="button"
                      onClick={() => setShowVpsPassword(!showVpsPassword)}
                      className="text-primary text-[11px] hover:underline flex items-center gap-1"
                    >
                      {showVpsPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                      {showVpsPassword ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                  <p className="text-sm font-mono text-foreground mt-1">
                    {user.assignedIp.password
                      ? showVpsPassword
                        ? user.assignedIp.password
                        : '••••••••••••'
                      : '—'}
                  </p>
                </div>
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">Node Label</span>
                  <p className="text-sm text-foreground mt-1">{user.assignedIp.label || '—'}</p>
                </div>
                <div className="bg-muted/30 p-3.5 rounded-lg border border-border">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">Assigned On</span>
                  <p className="text-sm text-foreground mt-1">
                    {user.assignedIp.assignedAt ? new Date(user.assignedIp.assignedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Channels List */}
      {activeTab === 'channels' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">User Channels</h3>
            <span className="text-xs text-muted-foreground">{user.channels.length} channels attached</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">Channel Name</th>
                <th className="text-left px-5 py-3 font-medium">Platform</th>
                <th className="text-left px-5 py-3 font-medium">External ID</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Added At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {user.channels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    This user has not added any channels yet.
                  </td>
                </tr>
              ) : (
                user.channels.map((c: any) => (
                  <tr key={c.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3.5 font-medium text-foreground">{c.channelName || 'Unnamed Channel'}</td>
                    <td className="px-5 py-3.5 capitalize text-muted-foreground">{c.platform}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{c.channelIdExt || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {new Date(c.addedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: Automations */}
      {activeTab === 'automations' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Recent Automation Tasks</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">Campaign</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Started At</th>
                <th className="text-left px-5 py-3 font-medium">Completed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {user.automations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No automation history found for this user.
                  </td>
                </tr>
              ) : (
                user.automations.map((a: any) => (
                  <tr key={a.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3.5 font-medium text-foreground">{a.campaign?.name || 'Standard Run'}</td>
                    <td className="px-5 py-3.5 capitalize text-xs text-muted-foreground">{a.runType}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium">
                        {a.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {a.startedAt ? new Date(a.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {a.completedAt ? new Date(a.completedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: Earnings */}
      {activeTab === 'earnings' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-foreground">User Earnings Breakdown</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">Campaign</th>
                <th className="text-left px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Date Earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {user.earnings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    No earnings recorded for this user yet.
                  </td>
                </tr>
              ) : (
                user.earnings.map((e: any) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3.5 text-foreground">{e.campaign?.name || 'General Payout'}</td>
                    <td className="px-5 py-3.5 font-bold text-emerald-600 dark:text-emerald-400">
                      ${Number(e.amount).toFixed(2)} {e.currency}
                    </td>
                    <td className="px-5 py-3.5 capitalize text-xs">{e.status}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {e.earnedAt ? new Date(e.earnedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 5: Account Settings & Reset Password */}
      {activeTab === 'settings' && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm max-w-lg">
          <h3 className="text-base font-semibold text-foreground mb-1">Reset User Password</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Set a new secure password for this user account.
          </p>

          {pwdMsg && (
            <div className={`p-3 rounded-lg text-xs mb-3 ${
              pwdMsg.includes('success')
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
            }`}>
              {pwdMsg}
            </div>
          )}

          <form onSubmit={handleResetPassword} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">New Password (min 8 chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={pwdLoading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {pwdLoading ? 'Updating Password...' : 'Save New Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
