'use client'

import { useState } from 'react'
import {
  Globe, Server, Plus, Search, Eye, EyeOff,
  UserCheck, UserX, Trash2, Edit3, Shield, Copy,
  Check, AlertCircle, ArrowRight
} from 'lucide-react'

interface UserOption {
  id: string
  name: string | null
  email: string
}

interface IpItem {
  id: string
  ipAddress: string
  port: number | null
  username: string | null
  password: string | null
  label: string | null
  notes: string | null
  isAvailable: boolean
  assignedTo: string | null
  assignedAt: string | null
  createdAt: string
  user: UserOption | null
}

interface IpManagementClientProps {
  initialIps: IpItem[]
  users: UserOption[]
}

export function IpManagementClient({ initialIps, users }: IpManagementClientProps) {
  const [ips, setIps] = useState<IpItem[]>(initialIps)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'available' | 'assigned'>('all')

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingIp, setEditingIp] = useState<IpItem | null>(null)
  const [assigningIp, setAssigningIp] = useState<IpItem | null>(null)

  // Add IP form state
  const [formData, setFormData] = useState({
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    label: '',
    notes: '',
    assignedTo: '',
  })

  // Assign user modal state
  const [selectedUserId, setSelectedUserId] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)

  // Visibility toggle for passwords
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggleReveal(id: string) {
    setRevealedPasswords((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Filtered IPs
  const filteredIps = ips.filter((ip) => {
    const matchesSearch =
      ip.ipAddress.toLowerCase().includes(search.toLowerCase()) ||
      (ip.label && ip.label.toLowerCase().includes(search.toLowerCase())) ||
      (ip.user?.email && ip.user.email.toLowerCase().includes(search.toLowerCase()))

    const matchesFilter =
      filter === 'all'
        ? true
        : filter === 'available'
        ? ip.isAvailable && !ip.assignedTo
        : !!ip.assignedTo

    return matchesSearch && matchesFilter
  })

  async function handleAddIp(e: React.FormEvent) {
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
          assignedTo: formData.assignedTo || null,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to add IP')

      // Refresh list
      const updated = await fetch('/api/admin/ip-addresses').then((r) => r.json())
      setIps(updated)
      setIsAddOpen(false)
      setFormData({
        ipAddress: '',
        port: 22,
        username: 'root',
        password: '',
        label: '',
        notes: '',
        assignedTo: '',
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAssignUser(e: React.FormEvent) {
    e.preventDefault()
    if (!assigningIp) return
    setAssignLoading(true)
    try {
      const res = await fetch(`/api/admin/ip-addresses/${assigningIp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: selectedUserId || null }),
      })
      if (res.ok) {
        const updated = await fetch('/api/admin/ip-addresses').then((r) => r.json())
        setIps(updated)
        setAssigningIp(null)
        setSelectedUserId('')
      }
    } finally {
      setAssignLoading(false)
    }
  }

  async function handleUnassign(ipId: string) {
    try {
      const res = await fetch(`/api/admin/ip-addresses/${ipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: null }),
      })
      if (res.ok) {
        const updated = await fetch('/api/admin/ip-addresses').then((r) => r.json())
        setIps(updated)
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function handleDelete(ipId: string) {
    if (!confirm('Are you sure you want to delete this IP record?')) return
    const res = await fetch(`/api/admin/ip-addresses/${ipId}`, { method: 'DELETE' })
    if (res.ok) {
      setIps((prev) => prev.filter((ip) => ip.id !== ipId))
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
        <div className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search by IP, label, or user email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={filter}
            onChange={(e: any) => setFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All IPs</option>
            <option value="available">Available Only</option>
            <option value="assigned">Assigned Only</option>
          </select>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus size={16} />
          Add New IP Address
        </button>
      </div>

      {/* IPs Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3.5 font-medium">Node / IP Address</th>
                <th className="text-left px-5 py-3.5 font-medium">SSH Connection Details</th>
                <th className="text-left px-5 py-3.5 font-medium">Assigned User</th>
                <th className="text-left px-5 py-3.5 font-medium">Status</th>
                <th className="text-right px-5 py-3.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredIps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                    No IP addresses found. Click "Add New IP Address" to register a VPS node.
                  </td>
                </tr>
              ) : (
                filteredIps.map((ip) => (
                  <tr key={ip.id} className="hover:bg-muted/20 transition-colors">
                    {/* IP & Label */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                          <Server size={18} />
                        </div>
                        <div>
                          <p className="font-mono font-bold text-foreground text-sm flex items-center gap-1.5">
                            {ip.ipAddress}
                            <button
                              onClick={() => handleCopy(ip.ipAddress, `ip-${ip.id}`)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Copy IP"
                            >
                              {copiedId === `ip-${ip.id}` ? (
                                <Check size={13} className="text-emerald-500" />
                              ) : (
                                <Copy size={13} />
                              )}
                            </button>
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {ip.label || 'No label'} · Port {ip.port || 22}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* SSH Details */}
                    <td className="px-5 py-4">
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">User:</span>
                          <span className="font-mono font-medium text-foreground">{ip.username || 'root'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Pass:</span>
                          <span className="font-mono text-foreground">
                            {ip.password ? (revealedPasswords[ip.id] ? ip.password : '••••••••') : '—'}
                          </span>
                          {ip.password && (
                            <button
                              onClick={() => toggleReveal(ip.id)}
                              className="text-primary hover:underline text-[11px]"
                            >
                              {revealedPasswords[ip.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Assigned User */}
                    <td className="px-5 py-4">
                      {ip.user ? (
                        <div className="space-y-0.5">
                          <p className="font-semibold text-foreground text-xs">{ip.user.name || 'User'}</p>
                          <p className="text-muted-foreground text-xs font-mono">{ip.user.email}</p>
                          {ip.assignedAt && (
                            <p className="text-[11px] text-muted-foreground">
                              Since {new Date(ip.assignedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">None (Pool Available)</span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-4">
                      {ip.assignedTo ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                          <UserCheck size={12} /> Assigned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Available
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {ip.assignedTo ? (
                          <button
                            onClick={() => handleUnassign(ip.id)}
                            className="px-2.5 py-1 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 rounded-md transition-colors"
                          >
                            Unassign
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setAssigningIp(ip)
                              setSelectedUserId('')
                            }}
                            className="px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
                          >
                            Assign to User
                          </button>
                        )}

                        <button
                          onClick={() => handleDelete(ip.id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                          title="Delete IP"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add IP Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-lg font-bold text-foreground">Add VPS / IP Address</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                {error}
              </div>
            )}

            <form onSubmit={handleAddIp} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-foreground mb-1">IP Address *</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.100"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Port</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e: any) => setFormData({ ...formData, port: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">SSH Username</label>
                  <input
                    type="text"
                    placeholder="root"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">SSH Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Node Label / Friendly Name</label>
                <input
                  type="text"
                  placeholder="e.g. VPS Node #1 - US East"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Assign to User (Optional)</label>
                <select
                  value={formData.assignedTo}
                  onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Leave Available in Pool</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? 'Adding...' : 'Add IP Address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign User Modal */}
      {assigningIp && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-foreground">
              Assign IP: <span className="font-mono text-primary">{assigningIp.ipAddress}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Select the user to assign this dedicated IP to. Any existing IP for that user will be replaced.
            </p>

            <form onSubmit={handleAssignUser} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Select User</label>
                <select
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">-- Choose User --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setAssigningIp(null)}
                  className="px-3 py-1.5 border border-border rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignLoading || !selectedUserId}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  {assignLoading ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
