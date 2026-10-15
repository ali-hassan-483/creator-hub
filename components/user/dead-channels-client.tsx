'use client'

import React, { useState } from 'react'
import {
  AlertOctagon,
  RotateCcw,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Info,
  Tv,
  Eye,
  ShieldAlert,
  Clock,
  Sparkles,
  X,
} from 'lucide-react'

export interface DeadVideoItem {
  videoIdExt: string
  title: string
  viewCount: number
  likes: number
  thumbnail: string
  publishedAt: string
}

export interface DeadChannelItem {
  id: string
  channelName: string
  channelHandle: string
  channelIdExt?: string | null
  channelEmail: string
  whopEmail: string
  niche: string
  status: string
  isDead: boolean
  deadDetectedAt: string
  videoCount: number
  maxViews: number
  avgViews: number
  videos: DeadVideoItem[]
}

interface DeadChannelsClientProps {
  initialChannels: DeadChannelItem[]
  initialStats: {
    totalDead: number
    scanInterval: string
    lastScannedAt: string
  }
}

export function DeadChannelsClient({ initialChannels, initialStats }: DeadChannelsClientProps) {
  const [channels, setChannels] = useState<DeadChannelItem[]>(initialChannels)
  const [stats, setStats] = useState(initialStats)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState('all')
  const [scanning, setScanning] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Delete Modal State
  const [deleteModalChannel, setDeleteModalChannel] = useState<DeadChannelItem | null>(null)
  const [deleteFromYoutubeChecked, setDeleteFromYoutubeChecked] = useState(false)
  const [unlinkFromWhopChecked, setUnlinkFromWhopChecked] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Unique niches
  const niches = Array.from(new Set(channels.map((c) => c.niche).filter(Boolean)))

  // Filter channels
  const filteredChannels = channels.filter((ch) => {
    const q = search.toLowerCase()
    const matchesQuery =
      ch.channelName.toLowerCase().includes(q) ||
      ch.channelHandle.toLowerCase().includes(q) ||
      ch.channelEmail.toLowerCase().includes(q) ||
      ch.whopEmail.toLowerCase().includes(q)
    const matchesNiche = nicheFilter === 'all' || ch.niche.toLowerCase() === nicheFilter.toLowerCase()
    return matchesQuery && matchesNiche
  })

  // 1. Scan Channels Now
  async function handleScanNow() {
    setScanning(true)
    setNotification(null)
    try {
      const res = await fetch('/api/user/dead-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to scan channels')

      setChannels(data.channels || [])
      setStats({
        totalDead: data.channels?.length || 0,
        scanInterval: '24 Hours',
        lastScannedAt: new Date().toISOString(),
      })
      setNotification({
        type: 'success',
        message: data.message || `Scan completed! Found ${data.channels?.length || 0} dead channels.`,
      })
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message })
    } finally {
      setScanning(false)
    }
  }

  // 2. Reactivate Channel
  async function handleReactivate(channel: DeadChannelItem) {
    setActionLoadingId(channel.id)
    setNotification(null)
    try {
      const res = await fetch('/api/user/dead-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate', channelId: channel.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reactivate channel')

      // Remove from dead channels list
      setChannels((prev) => prev.filter((c) => c.id !== channel.id))
      setStats((prev) => ({ ...prev, totalDead: Math.max(0, prev.totalDead - 1) }))
      setNotification({
        type: 'success',
        message: `Channel @${channel.channelHandle || channel.channelName} reactivated successfully! It is now active and ready for automations.`,
      })
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message })
    } finally {
      setActionLoadingId(null)
    }
  }

  // 3. Open Delete Modal
  function openDeleteModal(channel: DeadChannelItem) {
    setDeleteModalChannel(channel)
    setDeleteFromYoutubeChecked(false)
    setUnlinkFromWhopChecked(false)
    setNotification(null)
  }

  // 4. Confirm Delete Channel
  async function handleConfirmDelete() {
    if (!deleteModalChannel) return
    if (!deleteFromYoutubeChecked || !unlinkFromWhopChecked) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/user/channels/${deleteModalChannel.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete channel')

      // Remove from list
      setChannels((prev) => prev.filter((c) => c.id !== deleteModalChannel.id))
      setStats((prev) => ({ ...prev, totalDead: Math.max(0, prev.totalDead - 1) }))
      setNotification({
        type: 'success',
        message: `Channel @${deleteModalChannel.channelHandle || deleteModalChannel.channelName} has been permanently removed from the portal.`,
      })
      setDeleteModalChannel(null)
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 dark:bg-rose-500/20">
              <AlertOctagon size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Dead Channels
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 font-semibold border border-rose-500/20">
                  {channels.length} Detected
                </span>
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Channels whose latest 10 videos have under 100 views are automatically deactivated to protect posting limits.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning YouTube Data...' : 'Scan Channels Now'}
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium ${
            notification.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-card border border-border/50 shadow-sm flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500">
            <AlertOctagon size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Dead Channels</p>
            <p className="text-2xl font-bold text-foreground">{channels.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border/50 shadow-sm flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Auto-Refresh Interval</p>
            <p className="text-base font-bold text-foreground">Every 24 Hours</p>
            <p className="text-[10px] text-muted-foreground">Daily background evaluation</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border/50 shadow-sm flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Upload Protection</p>
            <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 size={15} /> Uploading Blocked
            </p>
            <p className="text-[10px] text-muted-foreground">Status automatically set to Inactive</p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search channel name, handle, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={nicheFilter}
            onChange={(e) => setNicheFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-xl text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Niches ({channels.length})</option>
            {niches.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Channels List */}
      {filteredChannels.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
            <CheckCircle2 size={24} />
          </div>
          <h3 className="text-base font-bold text-foreground">No Dead Channels Found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {search
              ? 'No dead channels match your search query.'
              : 'All your connected channels have healthy video views (>= 100 views) or are brand new.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredChannels.map((ch) => (
            <div
              key={ch.id}
              className="p-5 rounded-2xl bg-card border border-border/60 hover:border-border transition-all shadow-sm space-y-4"
            >
              {/* Channel Header Row */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
                    <Tv size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-foreground">{ch.channelName}</h3>
                      <span className="font-mono text-xs text-primary font-semibold">
                        {ch.channelHandle.startsWith('@') ? ch.channelHandle : `@${ch.channelHandle}`}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        Deactivated (Dead)
                      </span>
                      {ch.niche && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                          {ch.niche}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                      {ch.channelEmail && (
                        <span>
                          <strong className="text-foreground">Channel:</strong> {ch.channelEmail}
                        </span>
                      )}
                      {ch.whopEmail && (
                        <span>
                          <strong className="text-foreground">Whop:</strong> {ch.whopEmail}
                        </span>
                      )}
                      <span>
                        <strong className="text-foreground">Avg Views:</strong> {ch.avgViews}
                      </span>
                      <span>
                        <strong className="text-foreground">Max Views:</strong> {ch.maxViews}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2 Primary Actions */}
                <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                  {/* Action 1: Reactivate Channel */}
                  <button
                    onClick={() => handleReactivate(ch)}
                    disabled={actionLoadingId === ch.id}
                    title="Reactivate this channel and allow uploading again"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition disabled:opacity-50 shadow-sm"
                  >
                    <RotateCcw size={13} className={actionLoadingId === ch.id ? 'animate-spin' : ''} />
                    {actionLoadingId === ch.id ? 'Reactivating...' : 'Reactivate Channel'}
                  </button>

                  {/* Action 2: Want to Delete */}
                  <button
                    onClick={() => openDeleteModal(ch)}
                    title="Initiate channel deletion process"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold transition shadow-sm"
                  >
                    <Trash2 size={13} />
                    Want to Delete
                  </button>
                </div>
              </div>

              {/* Latest Videos Views Strip */}
              {ch.videos && ch.videos.length > 0 && (
                <div className="pt-3 border-t border-border/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Eye size={12} className="text-rose-500" />
                      Latest {ch.videos.length} Videos (All &lt; 100 views):
                    </span>
                    <span className="text-[10px] text-rose-500 font-medium">
                      Failed minimum 100 views threshold
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2">
                    {ch.videos.map((vid, i) => (
                      <div
                        key={vid.videoIdExt || i}
                        className="p-2 rounded-xl bg-muted/40 border border-rose-500/20 flex flex-col justify-between text-center space-y-1 hover:border-rose-500/40 transition"
                      >
                        <div className="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">
                          {vid.viewCount.toLocaleString()} views
                        </div>
                        <p className="text-[9px] text-muted-foreground truncate" title={vid.title}>
                          {vid.title || `Video #${i + 1}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal with 2 Required Checkboxes */}
      {deleteModalChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  <Trash2 size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Want to Delete Channel?</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {deleteModalChannel.channelName} (
                    <span className="font-mono text-primary">{deleteModalChannel.channelHandle}</span>)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDeleteModalChannel(null)}
                className="p-1 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>

            {/* Instruction Warning */}
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle size={14} /> Mandatory Confirmation
              </p>
              <p className="text-[11px] leading-relaxed opacity-90">
                To delete this channel from the portal, please verify and tick both checkmarks below:
              </p>
            </div>

            {/* 2 Checkboxes */}
            <div className="space-y-3.5 bg-muted/30 p-4 rounded-xl border border-border">
              {/* Checkbox 1: Delete from YouTube */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteFromYoutubeChecked}
                  onChange={(e) => setDeleteFromYoutubeChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-rose-600 focus:ring-rose-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-semibold text-foreground block">
                    Delete from YouTube
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-snug block mt-0.5">
                    I confirm that this channel has been deleted or handled on YouTube.
                  </span>
                </div>
              </label>

              <div className="border-t border-border/40" />

              {/* Checkbox 2: Unlink from Whop */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={unlinkFromWhopChecked}
                  onChange={(e) => setUnlinkFromWhopChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-rose-600 focus:ring-rose-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-semibold text-foreground block">
                    Unlink from Whop
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-snug block mt-0.5">
                    I confirm that this channel has been unlinked from my Whop account ({deleteModalChannel.whopEmail || 'Whop'}).
                  </span>
                </div>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalChannel(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted transition"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={!deleteFromYoutubeChecked || !unlinkFromWhopChecked || isDeleting}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition shadow-sm ${
                  deleteFromYoutubeChecked && unlinkFromWhopChecked && !isDeleting
                    ? 'bg-rose-600 hover:bg-rose-700 cursor-pointer'
                    : 'bg-rose-400/40 dark:bg-rose-950/40 text-muted-foreground cursor-not-allowed opacity-60'
                }`}
              >
                <Trash2 size={13} />
                {isDeleting ? 'Deleting Channel...' : 'Delete Channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
