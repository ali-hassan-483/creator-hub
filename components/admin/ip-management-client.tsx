'use client'

import { useState } from 'react'
import {
  Server, Plus, Search, Eye, EyeOff,
  UserCheck, UserX, Trash2, Edit3, Shield, Copy,
  Check, AlertCircle, Terminal, RefreshCw, Radio,
  CheckCircle2, XCircle, Sparkles, ExternalLink
} from 'lucide-react'

interface UserOption {
  id: string
  name: string | null
  email: string
  vpsId?: string | null
}

interface VpsNode {
  id: string
  ipAddress: string
  port: number
  username: string
  label: string
  notes: string | null
  isMainVps: boolean
  maxUsers: number
  assignedCount: number
  isAvailable: boolean
  status: 'online' | 'offline'
  lastPing: string | null
  apiKey: string | null
  createdAt: string
  users: UserOption[]
}

interface IpManagementClientProps {
  initialIps: VpsNode[]
  users: UserOption[]
}

export function IpManagementClient({ initialIps, users }: IpManagementClientProps) {
  const [nodes, setNodes] = useState<VpsNode[]>(initialIps)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'available' | 'full' | 'online'>('all')

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [assigningNode, setAssigningNode] = useState<VpsNode | null>(null)
  const [setupCommandNode, setSetupCommandNode] = useState<VpsNode | null>(null)

  // Add form state
  const [formData, setFormData] = useState({
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    label: '',
    notes: '',
    maxUsers: 2,
    userIds: [] as string[],
  })

  // Assign user modal state
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [assignLoading, setAssignLoading] = useState(false)

  // Copy states
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refreshNodes() {
    try {
      const res = await fetch('/api/admin/ip-addresses')
      if (res.ok) {
        const data = await res.json()
        setNodes(data)
      }
    } catch {}
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedKeyId(id)
    setTimeout(() => setCopiedKeyId(null), 2000)
  }

  function handleCopyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(true)
    setTimeout(() => setCopiedCmd(false), 2000)
  }

  // Filtered nodes
  const filteredNodes = nodes.filter((node) => {
    const matchesSearch =
      node.ipAddress.toLowerCase().includes(search.toLowerCase()) ||
      (node.label && node.label.toLowerCase().includes(search.toLowerCase())) ||
      node.users.some((u) => u.email.toLowerCase().includes(search.toLowerCase()))

    const matchesFilter =
      filter === 'all'
        ? true
        : filter === 'available'
        ? node.assignedCount < node.maxUsers
        : filter === 'full'
        ? node.assignedCount >= node.maxUsers
        : node.status === 'online'

    return matchesSearch && matchesFilter
  })

  async function handleAddNode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/ip-addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          port: Number(formData.port) || 22,
          maxUsers: Number(formData.maxUsers) || 2,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to add VPS node')

      await refreshNodes()
      setIsAddOpen(false)
      setFormData({
        ipAddress: '',
        port: 22,
        username: 'root',
        password: '',
        label: '',
        notes: '',
        maxUsers: 2,
        userIds: [],
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function openAssignModal(node: VpsNode) {
    setAssigningNode(node)
    setSelectedUserIds(node.users.map((u) => u.id))
    setError('')
  }

  async function handleSaveAssignment(e: React.FormEvent) {
    e.preventDefault()
    if (!assigningNode) return

    if (selectedUserIds.length > assigningNode.maxUsers) {
      setError(`Cannot assign more than ${assigningNode.maxUsers} users to this VPS node.`)
      return
    }

    setAssignLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/ip-addresses/${assigningNode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUserIds }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to update assignment')

      await refreshNodes()
      setAssigningNode(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAssignLoading(false)
    }
  }

  async function handleDelete(node: VpsNode) {
    if (node.isMainVps) {
      alert('The Main Server cannot be deleted.')
      return
    }
    if (!confirm(`Are you sure you want to remove VPS node "${node.label || node.ipAddress}"?`)) {
      return
    }

    try {
      const res = await fetch(`/api/admin/ip-addresses/${node.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      await refreshNodes()
    } catch (err: any) {
      alert(err.message)
    }
  }

  async function handleRegenerateKey(node: VpsNode) {
    if (!confirm(`Regenerate API key for "${node.label}"? You will need to update the key on the VPS worker daemon.`)) {
      return
    }
    try {
      const res = await fetch(`/api/admin/ip-addresses/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateKey: true }),
      })
      if (!res.ok) throw new Error('Failed to regenerate key')
      await refreshNodes()
    } catch (err: any) {
      alert(err.message)
    }
  }

  function getSetupCommand(node: VpsNode) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://creatorhub.chickenkiller.com'
    return `curl -sSL ${origin}/scripts/setup-vps-worker.sh | bash -s -- --key ${node.apiKey || 'YOUR_KEY'} --server ${origin}`
  }

  return (
    <div className="space-y-4">
      {/* Search, Filter & Add Node Button */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder="Search by IP, label, or assigned user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('available')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === 'available' ? 'bg-emerald-500 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Available
            </button>
            <button
              onClick={() => setFilter('full')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === 'full' ? 'bg-blue-500 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Full
            </button>
            <button
              onClick={() => setFilter('online')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === 'online' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Online
            </button>
          </div>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-sm"
        >
          <Plus size={15} />
          <span>Add Worker VPS</span>
        </button>
      </div>

      {/* Main Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Node / Host IP</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned Users (Max 2)</th>
                <th className="py-3 px-4">API Key & Setup</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    <Server size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="font-medium">No VPS nodes found.</p>
                    <p className="text-[11px] mt-1">Click "Add Worker VPS" to register an external upload node.</p>
                  </td>
                </tr>
              ) : (
                filteredNodes.map((node) => {
                  const isFull = node.assignedCount >= node.maxUsers
                  return (
                    <tr
                      key={node.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        node.isMainVps ? 'bg-purple-500/[0.02]' : ''
                      }`}
                    >
                      {/* Node / Host IP */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`p-2 rounded-xl mt-0.5 ${
                              node.isMainVps
                                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                : 'bg-blue-500/10 text-blue-500'
                            }`}
                          >
                            <Server size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">{node.label}</span>
                              {node.isMainVps && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                                  Main Server
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-mono text-xs text-muted-foreground">{node.ipAddress}</span>
                              <span className="text-[10px] text-muted-foreground/60">• Port {node.port}</span>
                            </div>
                            {node.notes && (
                              <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-1">
                                {node.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="space-y-1">
                          {node.status === 'online' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Online
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                              Offline
                            </span>
                          )}
                          {node.lastPing && (
                            <p className="text-[10px] text-muted-foreground">
                              Ping: {new Date(node.lastPing).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Assigned Users */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                isFull
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {node.assignedCount}/{node.maxUsers} Users {isFull ? '(Full)' : '(Available)'}
                            </span>
                          </div>

                          {node.users.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {node.users.map((u) => (
                                <span
                                  key={u.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[11px] font-medium"
                                >
                                  <UserCheck size={11} className="text-primary" />
                                  <span className="truncate max-w-[140px]">{u.name || u.email}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">No users assigned</span>
                          )}
                        </div>
                      </td>

                      {/* API Key & Setup Command */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1.5">
                          {node.apiKey && (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded border border-border">
                                {node.apiKey.slice(0, 10)}••••••••
                              </span>
                              <button
                                onClick={() => handleCopy(node.apiKey!, node.id)}
                                title="Copy API Key"
                                className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                              >
                                {copiedKeyId === node.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                              </button>
                            </div>
                          )}

                          <button
                            onClick={() => setSetupCommandNode(node)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                          >
                            <Terminal size={12} />
                            <span>View 1-Click Setup Command</span>
                          </button>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openAssignModal(node)}
                            className="px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition-colors"
                          >
                            Assign Users
                          </button>

                          {!node.isMainVps && (
                            <button
                              onClick={() => handleDelete(node)}
                              title="Delete VPS"
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Modal 1: Add VPS Node ────────────────────────────────────────── */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Add New Worker VPS Node</h3>
                <p className="text-xs text-muted-foreground">Register an external VPS node dedicated to uploading.</p>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleAddNode} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Host IP Address *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 192.168.1.100"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">SSH Port</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted-foreground font-semibold mb-1">Friendly Label *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. US East Upload Node 1"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Max Users (Default 2)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={formData.maxUsers}
                    onChange={(e) => setFormData({ ...formData, maxUsers: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">SSH Username (Optional)</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted-foreground font-semibold mb-1">Notes / Region (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Dedicated clean IP for User 1 & 2 in Germany"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 border border-border rounded-xl text-muted-foreground hover:text-foreground font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm"
                >
                  {loading ? 'Creating...' : 'Register VPS Node'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal 2: Assign Users ────────────────────────────────────────── */}
      {assigningNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Assign Users to {assigningNode.label}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Select up to {assigningNode.maxUsers} users. Their YouTube uploads will execute through this VPS.
                </p>
              </div>
              <button
                onClick={() => setAssigningNode(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveAssignment} className="space-y-3.5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>Select Users</span>
                <span
                  className={
                    selectedUserIds.length > assigningNode.maxUsers
                      ? 'text-rose-500 font-bold'
                      : 'text-foreground'
                  }
                >
                  {selectedUserIds.length} / {assigningNode.maxUsers} selected
                </span>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1.5 border border-border rounded-xl p-2 bg-background">
                {users.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No users found.</p>
                ) : (
                  users.map((u) => {
                    const isChecked = selectedUserIds.includes(u.id)
                    const assignedToOther =
                      u.vpsId && u.vpsId !== assigningNode.id ? ' (Assigned to other VPS)' : ''

                    return (
                      <label
                        key={u.id}
                        className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                          isChecked
                            ? 'bg-primary/10 border border-primary/20 text-foreground font-semibold'
                            : 'hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserIds([...selectedUserIds, u.id])
                            } else {
                              setSelectedUserIds(selectedUserIds.filter((id) => id !== u.id))
                            }
                          }}
                          className="rounded text-primary focus:ring-primary w-4 h-4"
                        />
                        <div className="flex-1 truncate">
                          <p className="text-foreground font-medium truncate">{u.name || u.email}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {u.email} {assignedToOther}
                          </p>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setAssigningNode(null)}
                  className="px-4 py-2 border border-border rounded-xl text-xs text-muted-foreground hover:text-foreground font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignLoading || selectedUserIds.length > assigningNode.maxUsers}
                  className="px-5 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm"
                >
                  {assignLoading ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal 3: 1-Click Setup Command ─────────────────────────────────── */}
      {setupCommandNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-xl shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Terminal size={20} className="text-purple-500" />
                <h3 className="text-base font-bold text-foreground">
                  Setup Worker on {setupCommandNode.label}
                </h3>
              </div>
              <button
                onClick={() => setSetupCommandNode(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                Log into your new VPS terminal via SSH as root, then copy and paste this command:
              </p>

              <div className="relative group">
                <pre className="p-3.5 bg-zinc-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-x-auto border border-zinc-800 whitespace-pre-wrap break-all">
                  {getSetupCommand(setupCommandNode)}
                </pre>
                <button
                  onClick={() => handleCopyCmd(getSetupCommand(setupCommandNode))}
                  className="absolute right-2.5 top-2.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-[10px] flex items-center gap-1 transition-all"
                >
                  {copiedCmd ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copiedCmd ? 'Copied!' : 'Copy Command'}</span>
                </button>
              </div>

              <div className="p-3.5 bg-muted/40 rounded-xl space-y-2 border border-border text-[11px]">
                <p className="font-bold text-foreground">What this automated script does:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Checks and installs Node.js 20 LTS & PM2 process manager</li>
                  <li>Downloads the lightweight upload worker daemon</li>
                  <li>Configures the VPS Secret API Key and auto-connects to Creator Hub</li>
                  <li>Configures automatic startup so it reboots with the VPS</li>
                  <li>Lightweight — requires no FFMPEG (pure upload node)</li>
                </ul>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => handleRegenerateKey(setupCommandNode)}
                  className="text-muted-foreground hover:text-rose-500 flex items-center gap-1 text-[11px]"
                >
                  <RefreshCw size={12} />
                  <span>Regenerate API Key</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSetupCommandNode(null)}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl text-xs hover:bg-primary/90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
