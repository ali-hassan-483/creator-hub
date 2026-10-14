'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  UserPlus, Search, Globe, Tv, DollarSign,
  CheckCircle2, XCircle, ArrowUpRight, ArrowDownRight,
  MoreVertical, Shield, User as UserIcon, RefreshCw, Trash2
} from 'lucide-react'

interface IpOption {
  id: string
  ipAddress: string
  label: string | null
}

interface UserItem {
  id: string
  name: string | null
  email: string
  role: 'admin' | 'user'
  isActive: boolean
  createdAt: string | Date
  lastLoginAt: string | Date | null
  assignedIp: {
    id: string
    ipAddress: string
    port: number | null
    label: string | null
  } | null
  totalChannels: number
  channelsAddedToday: number
  channelsRemovedToday: number
  totalEarnings: number
  totalAutomations: number
}

interface UsersTableProps {
  initialUsers: UserItem[]
  availableIps: IpOption[]
}

export function UsersTable({ initialUsers, availableIps }: UsersTableProps) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
    ipAddressId: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filtered Users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(search.toLowerCase()))
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? u.isActive
        : !u.isActive
    return matchesSearch && matchesStatus
  })

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to create user')
      }

      // Refresh list
      const updatedList = await fetch('/api/admin/users').then((r) => r.json())
      setUsers(updatedList)
      setIsCreateOpen(false)
      setFormData({ name: '', email: '', password: '', role: 'user', ipAddressId: '' })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function toggleUserStatus(userId: string, currentStatus: boolean) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      })
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, isActive: !currentStatus } : u))
        )
      }
    } catch (err) {
      console.error('Failed to toggle status:', err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
        <div className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <UserPlus size={16} />
          Create New User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3.5 font-medium">User Profile</th>
                <th className="text-left px-5 py-3.5 font-medium">Channels & Daily Activity</th>
                <th className="text-left px-5 py-3.5 font-medium">Assigned IP / VPS</th>
                <th className="text-left px-5 py-3.5 font-medium">Earnings</th>
                <th className="text-left px-5 py-3.5 font-medium">Status</th>
                <th className="text-right px-5 py-3.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    No users found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                    {/* User Profile */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                          {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                              {user.name || 'Unnamed User'}
                            </span>
                            {user.role === 'admin' && (
                              <span className="text-[11px] px-1.5 py-0.2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded font-semibold border border-amber-500/20">
                                ADMIN
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">{user.email}</span>
                        </div>
                      </div>
                    </td>

                    {/* Channels & Daily activity */}
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <Tv size={14} className="text-muted-foreground" />
                          <span>{user.totalChannels} channels</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-medium">
                            <ArrowUpRight size={13} />
                            +{user.channelsAddedToday} today
                          </span>
                          {user.channelsRemovedToday > 0 && (
                            <span className="flex items-center text-rose-500 font-medium">
                              <ArrowDownRight size={13} />
                              -{user.channelsRemovedToday} today
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Assigned IP */}
                    <td className="px-5 py-4">
                      {user.assignedIp ? (
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
                          <Globe size={13} className="text-blue-500" />
                          <span className="font-mono font-medium text-foreground">
                            {user.assignedIp.ipAddress}
                          </span>
                          {user.assignedIp.label && (
                            <span className="text-muted-foreground text-[11px]">
                              ({user.assignedIp.label})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium border border-amber-500/20">
                          No IP Assigned
                        </span>
                      )}
                    </td>

                    {/* Earnings */}
                    <td className="px-5 py-4">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        ${user.totalEarnings.toFixed(2)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">
                      <button
                        onClick={() => toggleUserStatus(user.id, user.isActive)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                          user.isActive
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/20'
                        }`}
                        title="Click to toggle status"
                      >
                        {user.isActive ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {user.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-xs font-semibold transition-colors"
                      >
                        Manage Account
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal Dialog */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-lg font-bold text-foreground">Create User Account</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Password * (Minimum 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e: any) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="user">User (Standard)</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Assign IP / VPS
                  </label>
                  <select
                    value={formData.ipAddressId}
                    onChange={(e) => setFormData({ ...formData, ipAddressId: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">None (Assign later)</option>
                    {availableIps.map((ip) => (
                      <option key={ip.id} value={ip.id}>
                        {ip.ipAddress} {ip.label ? `(${ip.label})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
