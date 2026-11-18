'use client'

import { useEffect, useState, useCallback } from 'react'
import { MultiSelectDropdown } from './multi-select-dropdown'
import {
  BarChart2,
  Eye,
  Heart,
  RefreshCw,
  Search,
  Trash2,
  Clock,
  CheckCircle2,
  Loader2,
  Youtube,
  Filter
} from 'lucide-react'

interface VideoStatSlot {
  id: string
  videoIdExt: string
  title: string
  views: number
  likes: number
  publishedAt: string | null
  hasCrossedThreshold: boolean
}

interface ChannelAnalyticsRow {
  id: string
  channelName: string
  channelHandle: string
  niche: string
  videos: (VideoStatSlot | null)[]
  totalViews: number
  totalLikes: number
  status: string
  updatedAt: string
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function formatDatetime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }) + ', ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default function AnalyticsClient() {
  const [rows, setRows] = useState<ChannelAnalyticsRow[]>([])
  const [niches, setNiches] = useState<string[]>([])
  const [selectedNiches, setSelectedNiches] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [minViewsInput, setMinViewsInput] = useState('')
  const [appliedMinViews, setAppliedMinViews] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Real 6-hour refresh countdown timer synced with backend nextSyncAt
  const [countdownSeconds, setCountdownSeconds] = useState(21600)
  const [nextSyncTarget, setNextSyncTarget] = useState<number | null>(null)

  // Sorting: sortIndex = 0..9 (Video #1..#10) or -1 (Total Views)
  const [sortIndex, setSortIndex] = useState<number | null>(null)
  const [sortAsc, setSortAsc] = useState<boolean>(false) // default false = descending (high to low)

  const handleSort = (idx: number) => {
    if (sortIndex === idx) {
      setSortAsc((prev) => !prev)
    } else {
      setSortIndex(idx)
      setSortAsc(false) // high to low first
    }
  }

  const formatCountdown = (secs: number) => {
    const h = String(Math.floor(secs / 3600)).padStart(2, '0')
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0')
    const s = String(secs % 60).padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (appliedMinViews > 0) params.set('minViews', String(appliedMinViews))

      const res = await fetch(`/api/user/analytics?${params.toString()}`)
      const data = await res.json()
      if (data.rows) setRows(data.rows)
      if (data.niches) setNiches(data.niches)
      if (data.nextSyncAt) {
        const targetMs = new Date(data.nextSyncAt).getTime()
        setNextSyncTarget(targetMs)
        setCountdownSeconds(Math.max(0, Math.floor((targetMs - Date.now()) / 1000)))
      }
    } catch (err) {
      console.error(err)
      showToast('Failed to load analytics', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, appliedMinViews])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  // Wall-clock synced countdown timer
  useEffect(() => {
    if (!nextSyncTarget) return
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((nextSyncTarget - Date.now()) / 1000))
      setCountdownSeconds(remaining)
      if (remaining === 0) {
        // Automatically refresh when countdown hits 0
        fetchAnalytics()
      }
    }
    updateTimer()
    const timer = setInterval(updateTimer, 1000)
    return () => clearInterval(timer)
  }, [nextSyncTarget, fetchAnalytics])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/user/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_all' }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Analytics refreshed!')
        if (data.nextSyncAt) {
          const targetMs = new Date(data.nextSyncAt).getTime()
          setNextSyncTarget(targetMs)
          setCountdownSeconds(Math.max(0, Math.floor((targetMs - Date.now()) / 1000)))
        } else {
          setCountdownSeconds(21600)
        }
        fetchAnalytics()
      }
    } catch {
      showToast('Error refreshing analytics', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  // Filtered and sorted rows
  const displayedRows = rows
    .filter((row) => {
      if (selectedNiches.length > 0 && !selectedNiches.includes(row.niche)) {
        return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortIndex === null) return 0
      let valA = 0
      let valB = 0
      if (sortIndex >= 0 && sortIndex < 10) {
        valA = a.videos[sortIndex]?.views || 0
        valB = b.videos[sortIndex]?.views || 0
      } else if (sortIndex === -1) {
        valA = a.totalViews || 0
        valB = b.totalViews || 0
      }
      return sortAsc ? valA - valB : valB - valA
    })

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm('Are you sure you want to remove this channel from analytics?')) return
    try {
      const res = await fetch('/api/user/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_channel', channelId }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Channel removed')
        fetchAnalytics()
      }
    } catch {
      showToast('Failed to delete channel', 'error')
    }
  }

  return (
    <div className="p-6 space-y-6 min-h-screen">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Top Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">YouTube Channel Analytics</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Real-time multi-channel video tracking &bull; Auto-synced every 6 hours
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 6h Countdown pill */}
          <div className="neu-pressed px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
            <Clock className="w-3.5 h-3.5" />
            <span>Refresh in {formatCountdown(countdownSeconds)}</span>
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="neu-primary-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Now
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="neu-flat rounded-2xl p-4 flex flex-wrap items-center gap-4 text-xs font-semibold">
        {/* Niche Multi-Select */}
        <MultiSelectDropdown
          label="Niche"
          placeholder="All Niches"
          options={niches}
          selected={selectedNiches}
          onChange={setSelectedNiches}
        />

        {/* Search Channel */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-muted)] whitespace-nowrap">Search:</span>
          <div className="relative">
            <input
              type="text"
              placeholder="Search channel name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-xl neu-pressed text-xs text-[var(--text-primary)] focus:outline-none w-48 sm:w-56"
            />
          </div>
        </div>

        {/* Views (10 videos) Filter */}
        <div className="flex items-center gap-2">
          <span className="text-rose-500 whitespace-nowrap">Views (10 videos):</span>
          <input
            type="number"
            placeholder="e.g. 1000"
            value={minViewsInput}
            onChange={(e) => setMinViewsInput(e.target.value)}
            className="px-3 py-1.5 rounded-xl neu-pressed text-xs text-[var(--text-primary)] focus:outline-none w-28"
          />
          <button
            onClick={() => setAppliedMinViews(parseInt(minViewsInput || '0', 10))}
            className="neu-primary-button px-3 py-1.5 rounded-xl text-xs"
          >
            Filter
          </button>
          {appliedMinViews > 0 && (
            <button
              onClick={() => {
                setMinViewsInput('')
                setAppliedMinViews(0)
              }}
              className="neu-button px-2 py-1 rounded-xl text-xs text-[var(--text-muted)]"
            >
              Clear
            </button>
          )}
        </div>

        <div className="ml-auto text-xs text-[var(--text-muted)]">
          Total: <span className="font-bold text-[var(--accent)]">{displayedRows.length}</span> channels
        </div>
      </div>

      {/* Main Multi-Channel Analytics Table */}
      <div className="neu-flat rounded-3xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
          </div>
        ) : displayedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="neu-pressed w-16 h-16 rounded-2xl flex items-center justify-center">
              <BarChart2 className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <div className="text-center">
              <p className="text-[var(--text-primary)] font-semibold">No Channel Data</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Add channels and run video clipping to view video metrics here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left font-semibold text-[var(--text-muted)] px-4 py-3.5 whitespace-nowrap">
                    Channel Name
                  </th>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                    const isSorted = sortIndex === num - 1
                    return (
                      <th
                        key={num}
                        onClick={() => handleSort(num - 1)}
                        className={`text-center font-semibold px-2 py-3.5 whitespace-nowrap cursor-pointer select-none transition-colors hover:text-primary ${
                          isSorted ? 'text-primary font-bold bg-primary/10' : 'text-[var(--text-muted)]'
                        }`}
                        title={`Click to sort channels top-to-bottom by Video #${num} views`}
                      >
                        <div className="inline-flex items-center justify-center gap-1">
                          <span>Video #{num}</span>
                          {isSorted && (
                            <span className="text-[10px] font-bold">{sortAsc ? '▲' : '▼'}</span>
                          )}
                        </div>
                      </th>
                    )
                  })}
                  <th
                    onClick={() => handleSort(-1)}
                    className={`text-center font-semibold px-3 py-3.5 whitespace-nowrap cursor-pointer select-none transition-colors hover:text-primary ${
                      sortIndex === -1 ? 'text-primary font-bold bg-primary/10' : 'text-[var(--text-muted)]'
                    }`}
                    title="Click to sort by total views"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Total Views</span>
                      {sortIndex === -1 && (
                        <span className="text-[10px] font-bold">{sortAsc ? '▲' : '▼'}</span>
                      )}
                    </div>
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Total Likes
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Status / Updated
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/5 transition-colors"
                  >
                    {/* Channel Name */}
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-[var(--text-primary)]">
                      <div className="font-semibold">{row.channelName}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{row.channelHandle}</div>
                    </td>

                    {/* Video #1 to Video #10 slots */}
                    {row.videos.map((vid, idx) => (
                      <td key={idx} className="px-1.5 py-3 text-center whitespace-nowrap">
                        {vid ? (
                          <a
                            href={`https://youtube.com/watch?v=${vid.videoIdExt}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`${vid.title} (${vid.views.toLocaleString()} views)`}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold transition-transform hover:scale-105 ${
                              vid.hasCrossedThreshold
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500'
                                : 'neu-pressed text-[var(--text-primary)]'
                            }`}
                          >
                            <span className="flex items-center gap-0.5 text-rose-500">
                              <Eye className="w-2.5 h-2.5" />
                              {formatViews(vid.views)}
                            </span>
                            <span className="text-[var(--text-muted)]">/</span>
                            <span className="flex items-center gap-0.5 text-red-400">
                              <Heart className="w-2.5 h-2.5" />
                              {formatViews(vid.likes)}
                            </span>
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] neu-pressed text-[var(--text-muted)] opacity-60">
                            <Eye className="w-2.5 h-2.5" /> 0 / <Heart className="w-2.5 h-2.5" /> 0
                          </span>
                        )}
                      </td>
                    ))}

                    {/* Total Views */}
                    <td className="px-3 py-3 text-center whitespace-nowrap font-bold text-[var(--text-primary)]">
                      {row.totalViews.toLocaleString()}
                    </td>

                    {/* Total Likes */}
                    <td className="px-3 py-3 text-center whitespace-nowrap font-semibold text-[var(--text-muted)]">
                      {row.totalLikes.toLocaleString()}
                    </td>

                    {/* Status / Updated */}
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Refreshed
                      </div>
                      <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                        {formatDatetime(row.updatedAt)}
                      </div>
                    </td>

                    {/* Delete Action */}
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteChannel(row.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors"
                        title="Delete channel from analytics"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
