'use client'

import { useState } from 'react'
import {
  Tv, Plus, Search, FileText, Upload, Copy,
  Check, ExternalLink, Trash2, Edit3, ArrowUpRight,
  ArrowDownRight, CheckCircle2, XCircle, AlertTriangle,
  Clock, Download, RefreshCw, LayoutGrid, LayoutList,
  Key, ShieldCheck, Eye, EyeOff, Sparkles, AlertCircle
} from 'lucide-react'

interface ChannelItem {
  id: string
  channelName: string | null
  channelHandle: string | null
  channelEmail?: string | null
  whopEmail?: string | null
  niche: string | null
  clientId: string | null
  platform: string
  status: 'active' | 'inactive' | 'pending' | 'error'
  extraData?: any
  addedAt: string
  _count?: {
    videoAnalytics: number
    automations?: number
  }
}

interface ChannelsClientProps {
  initialChannels: ChannelItem[]
  stats: {
    totalChannels: number
    addedToday: number
    removedToday: number
    activeCount: number
  }
}

export function ChannelsClient({ initialChannels, stats: initialStats }: ChannelsClientProps) {
  const [channels, setChannels] = useState<ChannelItem[]>(initialChannels)
  const [stats, setStats] = useState(initialStats)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState<string>('all')
  const [emailFilter, setEmailFilter] = useState<string>('all')
  const [whopEmailFilter, setWhopEmailFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')

  // Extract unique options for dropdowns
  const uniqueNiches = Array.from(new Set(channels.map((c) => c.niche).filter(Boolean))) as string[]
  const uniqueEmails = Array.from(new Set(channels.map((c) => c.channelEmail).filter(Boolean))) as string[]
  const uniqueWhopEmails = Array.from(new Set(channels.map((c) => c.whopEmail).filter(Boolean))) as string[]

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addTab, setAddTab] = useState<'single' | 'bulk' | 'csv'>('single')

  // Form State (All required fields including channelEmail & whopEmail)
  const [form, setForm] = useState({
    channelName: '',
    channelHandle: '',
    channelEmail: '',
    whopEmail: '',
    niche: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    status: 'active' as 'active' | 'inactive',
  })

  // Password visibility
  const [showSecret, setShowSecret] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // Bulk paste state
  const [bulkText, setBulkText] = useState('')

  // CSV state
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvParsed, setCsvParsed] = useState<Array<any>>([])

  // Loading & error
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<{ tested: boolean; success: boolean; message: string }>({
    tested: false,
    success: false,
    message: '',
  })
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Filter channels
  const filteredChannels = channels.filter((c) => {
    const q = search.trim().toLowerCase()
    const matchesSearch =
      !q ||
      (c.channelName && c.channelName.toLowerCase().includes(q)) ||
      (c.channelHandle && c.channelHandle.toLowerCase().includes(q)) ||
      (c.niche && c.niche.toLowerCase().includes(q)) ||
      (c.channelEmail && c.channelEmail.toLowerCase().includes(q))

    const matchesNiche = nicheFilter === 'all' || c.niche === nicheFilter
    const matchesEmail = emailFilter === 'all' || c.channelEmail === emailFilter
    const matchesWhopEmail = whopEmailFilter === 'all' || c.whopEmail === whopEmailFilter

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? c.status === 'active'
        : c.status !== 'active'

    return matchesSearch && matchesNiche && matchesEmail && matchesWhopEmail && matchesStatus
  })

  async function refreshChannels() {
    try {
      const res = await fetch('/api/user/channels')
      if (res.ok) {
        const data = await res.json()
        setChannels(data.channels)
        setStats(data.stats)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // 1. Single Channel Submit (Automatically tests credentials with Google OAuth)
  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Reset verification message
    setVerifyStatus({ tested: false, success: false, message: 'Verifying refresh token with Google OAuth...' })

    try {
      const res = await fetch('/api/user/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const result = await res.json()
      if (!res.ok) {
        setVerifyStatus({
          tested: true,
          success: false,
          message: result.error || 'Verification failed. Could not add channel.',
        })
        throw new Error(result.error || 'Failed to add channel')
      }

      await refreshChannels()
      setIsAddModalOpen(false)
      // Reset form
      setForm({
        channelName: '',
        channelHandle: '',
        channelEmail: '',
        whopEmail: '',
        niche: '',
        clientId: '',
        clientSecret: '',
        refreshToken: '',
        status: 'active',
      })
      setVerifyStatus({ tested: false, success: false, message: '' })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 2. Bulk Paste Submit
  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const lines = bulkText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (lines.length === 0) {
      setError('Please paste at least one channel.')
      setLoading(false)
      return
    }

    // Expecting CSV format in lines:
    // Name, Handler, Niche, Client_ID, Client_Secret, Refresh_Token, Status
    const parsedChannels = []
    for (const line of lines) {
      const p = line.split(',').map((x) => x.trim())
      if (p.length < 6) {
        setError(`Line "${line.slice(0, 30)}..." does not have all required fields (Name, Handler, Niche, Client_ID, Client_Secret, Refresh_Token).`)
        setLoading(false)
        return
      }
      parsedChannels.push({
        channelName: p[0],
        channelHandle: p[1],
        niche: p[2],
        clientId: p[3],
        clientSecret: p[4],
        refreshToken: p[5],
        status: (p[6]?.toLowerCase() === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
      })
    }

    try {
      const res = await fetch('/api/user/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: parsedChannels }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Bulk verification/import failed.')

      await refreshChannels()
      setIsAddModalOpen(false)
      setBulkText('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 3. CSV File Handling
  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFile(file)
    setError('')

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      if (!text) return

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length <= 1) {
        setError('CSV file appears empty or only has headers.')
        return
      }

      // Check header
      const startIndex = lines[0].toLowerCase().includes('channel') || lines[0].toLowerCase().includes('client') ? 1 : 0
      const parsed: Array<any> = []

      for (let i = startIndex; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
        if (parts.length >= 6) {
          parsed.push({
            channelName: parts[0],
            channelHandle: parts[1],
            niche: parts[2],
            clientId: parts[3],
            clientSecret: parts[4],
            refreshToken: parts[5],
            status: parts[6]?.toLowerCase() === 'inactive' ? 'inactive' : 'active',
          })
        }
      }
      setCsvParsed(parsed)
    }
    reader.readAsText(file)
  }

  async function handleCsvSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (csvParsed.length === 0) {
      setError('No valid channels found in CSV file. Ensure all 6 required credential fields are included.')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/user/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: csvParsed }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'CSV import failed.')

      await refreshChannels()
      setIsAddModalOpen(false)
      setCsvFile(null)
      setCsvParsed([])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function downloadCsvTemplate() {
    const csvContent =
      'data:text/csv;charset=utf-8,Channel Name,Channels Handler,Niche,Client_ID,Client Secret,Refresh Token,Status\nDaily Gaming Clips,@DailyGamingClips,Gaming,1234567890-abc.apps.googleusercontent.com,GOCSPX-secret123,1//04xyzRefreshToken...,Active\nTech Daily,@TechDaily,Technology,1234567890-abc.apps.googleusercontent.com,GOCSPX-secret123,1//04abcRefreshToken...,Active\n'
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', 'youtube_channels_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Status Switcher
  async function handleStatusChange(channelId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/user/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setChannels((prev) =>
          prev.map((c) => (c.id === channelId ? { ...c, status: newStatus as any } : c))
        )
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Remove Channel
  async function handleRemoveChannel(channelId: string) {
    if (!confirm('Are you sure you want to remove this channel?')) return
    try {
      const res = await fetch(`/api/user/channels/${channelId}`, { method: 'DELETE' })
      if (res.ok) {
        await refreshChannels()
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Channels</span>
            <Tv size={16} className="text-primary" />
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.totalChannels}</p>
          <span className="text-xs text-muted-foreground">Connected YouTube channels</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Added Today</span>
            <ArrowUpRight size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+{stats.addedToday}</p>
          <span className="text-xs text-muted-foreground">Channels registered today</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Removed Today</span>
            <ArrowDownRight size={16} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600">-{stats.removedToday}</p>
          <span className="text-xs text-muted-foreground">Channels detached today</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Channels</span>
            <ShieldCheck size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.activeCount}</p>
          <span className="text-xs text-muted-foreground">Verified & active for automations</span>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {/* Niche Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">Niche:</span>
            <select
              value={nicheFilter}
              onChange={(e) => setNicheFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none"
            >
              <option value="all">All Niches</option>
              {uniqueNiches.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* Email Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">Email:</span>
            <select
              value={emailFilter}
              onChange={(e) => setEmailFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none max-w-[200px]"
            >
              <option value="all">All Emails</option>
              {uniqueEmails.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </select>
          </div>

          {/* Whop Email Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">Whop Email:</span>
            <select
              value={whopEmailFilter}
              onChange={(e) => setWhopEmailFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none max-w-[200px]"
            >
              <option value="all">All Whop Emails</option>
              {uniqueWhopEmails.map((wem) => (
                <option key={wem} value={wem}>
                  {wem}
                </option>
              ))}
            </select>
          </div>

          {/* Search channel name */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">Search:</span>
            <input
              type="text"
              placeholder="Search channel name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-xl neu-pressed text-xs text-[var(--text-primary)] focus:outline-none w-48 sm:w-56"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex border border-border rounded-lg p-0.5 bg-muted/40">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                viewMode === 'table' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
              title="Table View"
            >
              <LayoutList size={15} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                viewMode === 'grid' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
              title="Grid View"
            >
              <LayoutGrid size={15} />
            </button>
          </div>

          <button
            onClick={() => {
              setIsAddModalOpen(true)
              setError('')
              setVerifyStatus({ tested: false, success: false, message: '' })
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add Channel
          </button>
        </div>
      </div>

      {/* Main Channels Table / Grid */}
      {viewMode === 'table' ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-left px-5 py-3.5 font-medium">Channel Name</th>
                  <th className="text-left px-5 py-3.5 font-medium">Handler</th>
                  <th className="text-left px-5 py-3.5 font-medium">Niche</th>
                  <th className="text-left px-5 py-3.5 font-medium">Client ID</th>
                  <th className="text-left px-5 py-3.5 font-medium">Status</th>
                  <th className="text-left px-5 py-3.5 font-medium">Added Date</th>
                  <th className="text-right px-5 py-3.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredChannels.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                      No channels found. Click "+ Add Channel" to register a YouTube channel.
                    </td>
                  </tr>
                ) : (
                  filteredChannels.map((ch) => (
                    <tr key={ch.id} className="hover:bg-muted/20 transition-colors">
                      {/* Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center font-bold">
                            <Tv size={18} />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground text-sm">{ch.channelName || 'YouTube Channel'}</p>
                            <span className="text-[11px] text-muted-foreground capitalize">YouTube</span>
                          </div>
                        </div>
                      </td>

                      {/* Handler */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-primary">
                          <span>{ch.channelHandle || '—'}</span>
                          {ch.channelHandle && (
                            <button
                              onClick={() => handleCopy(ch.channelHandle!, `hnd-${ch.id}`)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Copy Handler"
                            >
                              {copiedId === `hnd-${ch.id}` ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Niche */}
                      <td className="px-5 py-4">
                        <span className="text-xs px-2.5 py-1 rounded-md bg-muted font-medium text-foreground">
                          {ch.niche || 'General'}
                        </span>
                      </td>

                      {/* Client ID */}
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[140px] block" title={ch.clientId || ''}>
                          {ch.clientId ? `${ch.clientId.slice(0, 14)}...` : '—'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <select
                          value={ch.status === 'active' ? 'active' : 'inactive'}
                          onChange={(e) => handleStatusChange(ch.id, e.target.value)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer ${
                            ch.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Not Active</option>
                        </select>
                      </td>

                      {/* Added Date */}
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Date(ch.addedAt).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => handleRemoveChannel(ch.id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                          title="Remove Channel"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid Card View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChannels.length === 0 ? (
            <div className="col-span-full bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
              No channels found.
            </div>
          ) : (
            filteredChannels.map((ch) => (
              <div key={ch.id} className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center font-bold">
                      <Tv size={18} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground text-sm truncate max-w-[170px]">
                        {ch.channelName}
                      </h4>
                      <p className="text-xs text-primary font-mono truncate max-w-[170px]">
                        {ch.channelHandle}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveChannel(ch.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                    title="Remove Channel"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-border text-xs justify-between">
                  <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    {ch.niche || 'General'}
                  </span>
                  <select
                    value={ch.status === 'active' ? 'active' : 'inactive'}
                    onChange={(e) => handleStatusChange(ch.id, e.target.value)}
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer ${
                      ch.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Not Active</option>
                  </select>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add Channels Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-xl w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-lg font-bold text-foreground">Add YouTube Channel</h3>
                <p className="text-xs text-muted-foreground">
                  Credentials are automatically tested with Google OAuth to verify the refresh token.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {/* Method Tabs */}
            <div className="grid grid-cols-3 gap-2 bg-muted/40 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setAddTab('single')}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  addTab === 'single' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                }`}
              >
                <Plus size={13} /> Single Add
              </button>
              <button
                type="button"
                onClick={() => setAddTab('bulk')}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  addTab === 'bulk' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                }`}
              >
                <FileText size={13} /> Bulk Paste
              </button>
              <button
                type="button"
                onClick={() => setAddTab('csv')}
                className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  addTab === 'csv' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
                }`}
              >
                <Upload size={13} /> CSV Upload
              </button>
            </div>

            {/* Error / Feedback banners */}
            {error && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {verifyStatus.tested && (
              <div
                className={`p-3 text-xs rounded-lg border flex items-start gap-2 ${
                  verifyStatus.success
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                }`}
              >
                {verifyStatus.success ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
                <span>{verifyStatus.message}</span>
              </div>
            )}

            {/* TAB 1: Single Add (All 7 fields + Live Test) */}
            {addTab === 'single' && (
              <form onSubmit={handleSingleSubmit} className="space-y-3.5">
                {/* 1. Channel Name & 2. Handler */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Channel Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Daily Gaming Clips"
                      value={form.channelName}
                      onChange={(e) => setForm({ ...form, channelName: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Channels Handler *</label>
                    <input
                      type="text"
                      required
                      placeholder="@ChannelHandle"
                      value={form.channelHandle}
                      onChange={(e) => setForm({ ...form, channelHandle: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                {/* Channel Email (YouTube) & Whop Email */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Channels Email (YouTube) *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. ytaccount@gmail.com"
                      value={form.channelEmail}
                      onChange={(e) => setForm({ ...form, channelEmail: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Whop Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. whopaccount@gmail.com"
                      value={form.whopEmail}
                      onChange={(e) => setForm({ ...form, whopEmail: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                {/* 3. Niche & 7. Status */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Niche *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Gaming, Tech, Finance, Entertainment"
                      value={form.niche}
                      onChange={(e) => setForm({ ...form, niche: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={(e: any) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="active">Active (Ready for Automations)</option>
                      <option value="inactive">Not Active</option>
                    </select>
                  </div>
                </div>

                {/* 4. Client_ID */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Client_ID *</label>
                  <input
                    type="text"
                    required
                    placeholder="xxxx.apps.googleusercontent.com"
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* 5. Client Secret */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Client Secret *</label>
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showSecret ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <input
                    type={showSecret ? 'text' : 'password'}
                    required
                    placeholder="GOCSPX-xxxx..."
                    value={form.clientSecret}
                    onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* 6. Refresh Token */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Refresh Token *</label>
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      {showToken ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    required
                    placeholder="1//04xxxx..."
                    value={form.refreshToken}
                    onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Submit & Auto-Test Action Bar */}
                <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-primary shrink-0" />
                    <span>Automatically tests with Google OAuth on click</span>
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {loading && <RefreshCw size={14} className="animate-spin" />}
                      {loading ? 'Verifying with Google...' : 'Add Channel'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* TAB 2: Bulk Multi-Line Paste */}
            {addTab === 'bulk' && (
              <form onSubmit={handleBulkSubmit} className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">
                      Paste Channels (Comma separated per line) *
                    </label>
                    <span className="text-xs font-semibold text-primary font-mono">
                      {bulkText.split('\n').filter((l) => l.trim().length > 0).length} channels
                    </span>
                  </div>
                  <textarea
                    rows={7}
                    required
                    placeholder={`Daily Clips, @DailyClips, Gaming, Client_ID_1, Client_Secret_1, Refresh_Token_1, Active\nTech Hub, @TechHub, Tech, Client_ID_2, Client_Secret_2, Refresh_Token_2, Active`}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    className="w-full p-3 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Format: <code className="font-mono">Name, Handler, Niche, Client_ID, Client_Secret, Refresh_Token, Status</code>
                  </p>
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                  >
                    {loading ? 'Verifying All & Importing...' : 'Verify & Import All'}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 3: CSV Upload */}
            {addTab === 'csv' && (
              <form onSubmit={handleCsvSubmit} className="space-y-4">
                <div className="flex items-center justify-between bg-muted/30 p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Download CSV Template</p>
                    <p className="text-[11px] text-muted-foreground">Template includes all 7 fields with sample data.</p>
                  </div>
                  <button
                    type="button"
                    onClick={downloadCsvTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
                  >
                    <Download size={13} />
                    Download Template
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Select CSV File (.csv) *
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    required
                    onChange={handleCsvFileChange}
                    className="w-full text-xs text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer border border-input rounded-lg bg-background p-1"
                  />
                </div>

                {/* CSV Preview */}
                {csvParsed.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-foreground">
                      Preview ({csvParsed.length} channels ready to verify & import):
                    </span>
                    <div className="max-h-40 overflow-y-auto border border-border rounded-lg bg-muted/20 text-xs">
                      <table className="w-full">
                        <thead className="bg-muted/50 border-b border-border text-muted-foreground text-left">
                          <tr>
                            <th className="p-2">Name</th>
                            <th className="p-2">Handler</th>
                            <th className="p-2">Niche</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {csvParsed.map((row, i) => (
                            <tr key={i}>
                              <td className="p-2 font-medium">{row.channelName}</td>
                              <td className="p-2 font-mono text-primary">{row.channelHandle}</td>
                              <td className="p-2">{row.niche}</td>
                              <td className="p-2 capitalize">{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false)
                      setCsvFile(null)
                      setCsvParsed([])
                    }}
                    className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || csvParsed.length === 0}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                  >
                    {loading ? 'Verifying & Importing...' : `Verify & Import ${csvParsed.length} Channels`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
