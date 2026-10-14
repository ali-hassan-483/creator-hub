'use client'

import { useState, useEffect } from 'react'
import {
  Search,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Key,
  RefreshCw,
  Copy,
  Check,
  Globe,
  Tv,
  Loader2,
  Trash2,
  UserCheck,
  Users,
  Compass
} from 'lucide-react'

interface LinkedChannel {
  id: string
  name: string
  handle: string
  niche: string
}

interface WhopAccount {
  id: string
  userId: string
  userName: string
  userEmail: string
  whopEmail: string
  channels: LinkedChannel[]
  credentialId: string | null
  hasCookies: boolean
  status: 'active' | 'missing_cookies'
  lastUsedAt: string | null
  updatedAt: string | null
}

export function WhopAccountsClient() {
  const [accounts, setAccounts] = useState<WhopAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'missing'>('all')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyingCookiesId, setCopyingCookiesId] = useState<string | null>(null)
  const [copiedCookiesId, setCopiedCookiesId] = useState<string | null>(null)

  // Edit / Add Cookies Modal
  const [editModal, setEditModal] = useState<WhopAccount | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [savingCookies, setSavingCookies] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4500)
  }

  const fetchAccounts = async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await fetch('/api/admin/whop-accounts')
      const data = await res.json()
      if (data.accounts) {
        setAccounts(data.accounts)
      }
    } catch (err) {
      showToast('Failed to load Whop accounts', 'error')
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
  }, [])

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleCopyCookies = async (acc: WhopAccount) => {
    setCopyingCookiesId(acc.id)
    try {
      const res = await fetch('/api/admin/whop-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_cookies',
          userId: acc.userId,
          whopEmail: acc.whopEmail,
        }),
      })
      const data = await res.json()
      if (data.success && data.cookies) {
        navigator.clipboard.writeText(data.cookies)
        setCopiedCookiesId(acc.id)
        showToast('Session cookies JSON copied to clipboard!', 'success')
        setTimeout(() => setCopiedCookiesId(null), 3000)
      } else {
        showToast('No saved cookies to copy', 'error')
      }
    } catch (e: any) {
      showToast('Failed to copy cookies', 'error')
    } finally {
      setCopyingCookiesId(null)
    }
  }

  const handleOpenWhop = async (acc: WhopAccount) => {
    setOpeningId(acc.id)
    showToast(`Launching Incognito session for ${acc.whopEmail}...`, 'info')
    try {
      const res = await fetch('/api/admin/whop-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open_whop',
          userId: acc.userId,
          whopEmail: acc.whopEmail,
          credentialId: acc.credentialId,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message, 'success')
        fetchAccounts()
      } else {
        showToast(data.error || 'Failed to open Whop browser', 'error')
      }
    } catch (err: any) {
      showToast(err.message || 'Error triggering browser', 'error')
    } finally {
      setOpeningId(null)
    }
  }

  const handleSaveCookies = async () => {
    if (!editModal) return
    if (!cookieInput.trim()) {
      showToast('Please paste cookie or storageState JSON content', 'error')
      return
    }

    setSavingCookies(true)
    try {
      const res = await fetch('/api/admin/whop-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_cookies',
          userId: editModal.userId,
          whopEmail: editModal.whopEmail,
          cookies: cookieInput.trim(),
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message, 'success')
        setEditModal(null)
        setCookieInput('')
        fetchAccounts()
      } else {
        showToast(data.error || 'Failed to update cookies', 'error')
      }
    } catch (err: any) {
      showToast(err.message || 'Error updating cookies', 'error')
    } finally {
      setSavingCookies(false)
    }
  }

  const handleDeleteCookies = async (acc: WhopAccount) => {
    if (!confirm(`Are you sure you want to remove cookies for ${acc.whopEmail}?`)) return
    try {
      const res = await fetch('/api/admin/whop-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_cookies',
          userId: acc.userId,
          whopEmail: acc.whopEmail,
          credentialId: acc.credentialId,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Cookies removed successfully', 'success')
        fetchAccounts()
      }
    } catch (err) {
      showToast('Failed to delete cookies', 'error')
    }
  }

  const filteredAccounts = accounts.filter((acc) => {
    const matchesSearch =
      acc.whopEmail.toLowerCase().includes(search.toLowerCase()) ||
      acc.userName.toLowerCase().includes(search.toLowerCase()) ||
      acc.userEmail.toLowerCase().includes(search.toLowerCase()) ||
      acc.channels.some((c) => c.name.toLowerCase().includes(search.toLowerCase()))

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? acc.hasCookies
        : !acc.hasCookies

    return matchesSearch && matchesStatus
  })

  const totalActive = accounts.filter((a) => a.hasCookies).length
  const totalMissing = accounts.filter((a) => !a.hasCookies).length

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-4 ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : toast.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              : 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400'
          }`}
        >
          {toast.type === 'success' && <Check className="w-4 h-4 text-emerald-500" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500" />}
          {toast.type === 'info' && <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />}
          {toast.msg}
        </div>
      )}

      {/* Top Banner / Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Whop Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage user Whop accounts, active session cookies, and launch authenticated Incognito browser sessions.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 neu-flat rounded-2xl text-xs">
            <Users size={14} className="text-purple-600 dark:text-purple-400" />
            <span className="font-bold text-foreground">{accounts.length}</span>
            <span className="text-muted-foreground">Total Accounts</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 neu-flat rounded-2xl text-xs">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{totalActive}</span>
            <span className="text-muted-foreground">Active Cookies</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 neu-flat rounded-2xl text-xs">
            <AlertCircle size={14} className="text-amber-500" />
            <span className="font-bold text-amber-600 dark:text-amber-400">{totalMissing}</span>
            <span className="text-muted-foreground">Missing Cookies</span>
          </div>
          <button
            onClick={() => fetchAccounts(true)}
            disabled={refreshing}
            className="neu-button p-2 rounded-2xl text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            title="Refresh accounts"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
        <div className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search by Whop email, user, channel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="neu-pressed w-full pl-10 pr-4 py-2.5 rounded-2xl text-xs text-foreground focus:outline-hidden"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="neu-pressed px-3.5 py-2.5 rounded-2xl text-xs text-foreground focus:outline-hidden cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active Cookies</option>
            <option value="missing">Missing Cookies</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="neu-flat rounded-3xl p-5 border border-border/40 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground text-xs">
                <th className="text-left pb-3 px-3 font-semibold">User Profile</th>
                <th className="text-left pb-3 px-3 font-semibold">Whop Account Email</th>
                <th className="text-left pb-3 px-3 font-semibold">Linked Channels</th>
                <th className="text-left pb-3 px-3 font-semibold">Cookie Status</th>
                <th className="text-right pb-3 px-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
                    Loading Whop accounts...
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground text-xs">
                    No Whop accounts found.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-accent/5 transition-colors group">
                    {/* User Profile */}
                    <td className="py-4 px-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-2xl neu-pressed flex items-center justify-center font-extrabold text-xs text-purple-600 dark:text-purple-400">
                          {acc.userName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-foreground">
                            {acc.userName}
                          </div>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {acc.userEmail}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Whop Email */}
                    <td className="py-4 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2.5 py-1 rounded-xl text-xs font-mono font-medium neu-pressed text-purple-600 dark:text-purple-400">
                          {acc.whopEmail}
                        </span>
                        <button
                          onClick={() => handleCopy(acc.whopEmail, acc.id)}
                          className="p-1 rounded-lg hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-all"
                          title="Copy Whop Email"
                        >
                          {copiedId === acc.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Linked Channels */}
                    <td className="py-4 px-3">
                      {acc.channels.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[240px]">
                          {acc.channels.map((ch) => (
                            <span
                              key={ch.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                            >
                              <Tv className="w-2.5 h-2.5" />
                              {ch.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Cookie Status */}
                    <td className="py-4 px-3">
                      {acc.hasCookies ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-3 h-3" /> Active Cookies
                          </span>
                          {acc.lastUsedAt && (
                            <div className="text-[10px] text-muted-foreground">
                              Used {new Date(acc.lastUsedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            <AlertCircle className="w-3 h-3" /> Missing Cookies
                          </span>
                          <div className="text-[10px] text-muted-foreground">
                            Session not configured
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-4 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {/* Open Whop in Incognito Button */}
                        <button
                          onClick={() => handleOpenWhop(acc)}
                          disabled={openingId === acc.id}
                          className="neu-primary-button inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-bold tracking-tight disabled:opacity-40"
                          title="Open Whop with cookies in Incognito window"
                        >
                          {openingId === acc.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Compass className="w-3.5 h-3.5 text-purple-300" />
                          )}
                          Open Whop
                          <ExternalLink className="w-3 h-3 opacity-70" />
                        </button>

                        {/* Copy Cookies JSON Button */}
                        {acc.hasCookies && (
                          <button
                            onClick={() => handleCopyCookies(acc)}
                            disabled={copyingCookiesId === acc.id}
                            className="neu-button p-2 rounded-2xl text-purple-600 dark:text-purple-400 hover:text-purple-700 transition-all"
                            title="Copy Session Cookies JSON to clipboard"
                          >
                            {copiedCookiesId === acc.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : copyingCookiesId === acc.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        {/* Edit Cookies */}
                        <button
                          onClick={() => {
                            setEditModal(acc)
                            setCookieInput('')
                          }}
                          className="neu-button p-2 rounded-2xl text-muted-foreground hover:text-foreground transition-all"
                          title="Update Whop Cookies"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>

                        {acc.hasCookies && (
                          <button
                            onClick={() => handleDeleteCookies(acc)}
                            className="neu-button p-2 rounded-2xl text-rose-500 hover:text-rose-600 transition-all"
                            title="Delete Cookies"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Cookies Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="neu-flat bg-background border border-border w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Update Whop Cookies
                </h3>
                <p className="text-xs text-muted-foreground">
                  {editModal.userName} • {editModal.whopEmail}
                </p>
              </div>
              <button
                onClick={() => setEditModal(null)}
                className="neu-button p-1.5 rounded-xl text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Paste the Playwright storageState JSON or exported cookies for this Whop account. When you click &quot;Open Whop&quot;, these cookies will be injected into an incognito Chrome session.
            </p>

            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Session Storage / Cookies JSON
              </label>
              <textarea
                rows={6}
                placeholder={'{"cookies": [...], "origins": [...]}'}
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                className="neu-pressed w-full rounded-2xl p-3 text-[11px] font-mono text-foreground focus:outline-hidden resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditModal(null)}
                className="neu-button px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCookies}
                disabled={savingCookies}
                className="neu-primary-button px-5 py-2 rounded-xl text-xs font-bold disabled:opacity-40"
              >
                {savingCookies ? 'Saving...' : 'Save Cookies'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
