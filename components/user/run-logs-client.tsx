'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  MoreVertical,
  AlertTriangle,
  AlertCircle,
  Play,
  Pause,
  Trash2,
  XCircle,
  CheckCircle2,
  Loader2,
  Youtube,
  Download,
  Timer,
  FlaskConical,
  ChevronLeft,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VideoUpload {
  id: string
  channelId?: string
  channelName: string
  campaign: string
  stage: string
  videoTitle: string
  youtubeLink: string | null
  uploadedAt: string
  error?: string | null
}

interface WhopSubmission {
  id: string
  videoTitle: string
  youtubeLink: string | null
  queuedAt: string
  timeTaken: number | null // minutes
  status: 'pending' | 'submitted' | 'failed'
  whopEmail: string
}

interface ChannelRef {
  id: string
  name: string
  handle: string
  email: string
  whopEmail: string
}

interface RunLogRow {
  id: string
  triggeredAt: string
  startedAt: string | null
  completedAt: string | null
  name: string
  runType: 'immediate' | 'scheduled'
  status: 'success' | 'partial' | 'cancelled' | 'running' | 'queued' | 'failed' | 'paused'
  campaign: { id: string; name: string } | null
  channels: ChannelRef[]
  activeSlots: number
  videoUploads: VideoUpload[]
  whopSubmissions: WhopSubmission[]
  cancelReason: string | null
  errorMessage: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDatetime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

function getTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function getRemainingTime(queuedAtISO: string, maxMinutes = 30): { minutes: number; seconds: number; expired: boolean; pct: number } {
  const queuedMs = new Date(queuedAtISO).getTime()
  const deadlineMs = queuedMs + maxMinutes * 60 * 1000
  const nowMs = Date.now()
  const remainMs = deadlineMs - nowMs

  if (remainMs <= 0) return { minutes: 0, seconds: 0, expired: true, pct: 0 }

  const minutes = Math.floor(remainMs / 60000)
  const seconds = Math.floor((remainMs % 60000) / 1000)
  const pct = Math.min(100, (remainMs / (maxMinutes * 60 * 1000)) * 100)
  return { minutes, seconds, expired: false, pct }
}

// ─── Copy Button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy link"
      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 ${
        copied
          ? 'text-green-500 bg-green-50 dark:bg-green-900/20'
          : 'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10'
      } ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RunLogRow['status'] }) {
  const styles: Record<string, string> = {
    success: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    partial: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    cancelled: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    running: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    queued: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    paused: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  }
  const icons: Record<string, JSX.Element> = {
    success: <CheckCircle2 className="w-3 h-3" />,
    partial: <AlertTriangle className="w-3 h-3" />,
    cancelled: <XCircle className="w-3 h-3" />,
    failed: <XCircle className="w-3 h-3" />,
    running: <Loader2 className="w-3 h-3 animate-spin" />,
    queued: <Clock className="w-3 h-3" />,
    paused: <Pause className="w-3 h-3" />,
  }
  const labels: Record<string, string> = {
    success: 'Success',
    partial: 'Partial',
    cancelled: 'Cancelled',
    failed: 'Failed',
    running: 'Running',
    queued: 'Queued',
    paused: 'Paused',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${styles[status] || styles.queued}`}
    >
      {icons[status]}
      {labels[status] || status}
    </span>
  )
}

// ─── Countdown Timer Cell ──────────────────────────────────────────────────────

function CountdownCell({ queuedAt, status }: { queuedAt: string; status: WhopSubmission['status'] }) {
  const [remaining, setRemaining] = useState(() => getRemainingTime(queuedAt))

  useEffect(() => {
    if (status !== 'pending') return
    const interval = setInterval(() => {
      setRemaining(getRemainingTime(queuedAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [queuedAt, status])

  if (status !== 'pending') {
    return <span className="text-xs text-[var(--text-muted)]">—</span>
  }

  if (remaining.expired) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500"><Timer className="w-3 h-3" /> Expired</span>
  }

  const colorClass =
    remaining.pct > 50
      ? 'text-emerald-500'
      : remaining.pct > 20
      ? 'text-amber-500'
      : 'text-red-500'

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${colorClass}`}>
      <Timer className="w-3 h-3" />
      {String(remaining.minutes).padStart(2, '0')}:{String(remaining.seconds).padStart(2, '0')}
    </span>
  )
}

// ─── Details Modal ─────────────────────────────────────────────────────────────

function DetailsModal({
  row,
  onClose,
  onMarkWhopSubmitted,
  markingSubId,
}: {
  row: RunLogRow
  onClose: () => void
  onMarkWhopSubmitted: (subId: string) => Promise<void>
  markingSubId: string | null
}) {
  const [activeTab, setActiveTab] = useState<'video' | 'whop'>('video')

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="neu-flat rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Run Details</h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {row.campaign?.name || 'No Campaign'} &bull; {formatDatetime(row.triggeredAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(row.status === 'running' || row.status === 'queued') && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                Live Updating
              </span>
            )}
            <StatusBadge status={row.status} />
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] neu-button"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4">
          {(
            [
              { key: 'video', label: 'Video Submission', count: row.videoUploads.length },
              { key: 'whop', label: 'Whop Submission', count: row.whopSubmissions.length },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                activeTab === tab.key
                  ? 'neu-pressed text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                  activeTab === tab.key
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {activeTab === 'video' && (
            <div className="overflow-x-auto">
              {row.videoUploads.length === 0 ? (
                <div className="neu-pressed rounded-2xl p-8 text-center text-[var(--text-muted)] text-sm">
                  {row.status === 'cancelled'
                    ? `Run was cancelled: ${row.cancelReason || 'No reason provided'}`
                    : 'No video uploads recorded for this run.'}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {['#', 'Channel', 'Campaign', 'Stage', 'Video Title', 'YouTube Link'].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold text-[var(--text-muted)] pb-3 pr-4 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {row.videoUploads.map((upload, i) => {
                      const isFailed = upload.stage === 'Upload Failed' || !upload.youtubeLink
                      return (
                        <tr
                          key={upload.id}
                          className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/5 transition-colors"
                        >
                          <td className="py-3 pr-4 text-[var(--text-muted)] font-mono text-xs">
                            {i + 1}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-1.5">
                              {isFailed ? (
                                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              <span className="font-medium text-[var(--text-primary)]">
                                {upload.channelName}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-[var(--text-muted)] whitespace-nowrap">
                            {upload.campaign}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                upload.stage === 'Video Uploaded'
                                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                  : isFailed
                                  ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                              }`}
                            >
                              {isFailed && <AlertCircle className="w-3 h-3" />}
                              {upload.stage}
                            </span>
                          </td>
                          <td className="py-3 pr-4 max-w-[220px]">
                            <span
                              className="text-[var(--text-primary)] line-clamp-2 text-xs leading-snug"
                              title={upload.videoTitle}
                            >
                              {upload.videoTitle}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            {upload.youtubeLink ? (
                              <div className="flex items-center gap-1">
                                <a
                                  href={upload.youtubeLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline font-medium"
                                >
                                  <Youtube className="w-3.5 h-3.5" />
                                  Watch
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                                <CopyBtn text={upload.youtubeLink} />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium max-w-[260px]" title={upload.error || 'Failed'}>
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{upload.error || 'Limit Reached / Upload Failed'}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'whop' && (
            <div className="space-y-3">
              <div className="neu-pressed rounded-2xl p-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Manual submission required.</strong> Videos must be submitted to Whop
                  within <strong>30 minutes</strong> of upload. Pending videos will expire after the
                  timer runs out.
                </span>
              </div>

              {row.whopSubmissions.length === 0 ? (
                <div className="neu-pressed rounded-2xl p-8 text-center text-[var(--text-muted)] text-sm">
                  No Whop submissions for this run.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {[
                          'Title',
                          'Whop Email',
                          'YouTube Link',
                          'Queued At',
                          'Time Left (30m Max)',
                          'Time Taken',
                          'Status',
                          'Action',
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold text-[var(--text-muted)] pb-3 pr-4 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {row.whopSubmissions.map((sub) => (
                        <tr
                          key={sub.id}
                          className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/5 transition-colors"
                        >
                          <td className="py-3 pr-4 max-w-[180px]">
                            <span
                              className="text-[var(--text-primary)] text-xs line-clamp-2 leading-snug"
                              title={sub.videoTitle}
                            >
                              {sub.videoTitle}
                            </span>
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {sub.whopEmail ? (
                              <span className="text-xs text-[var(--accent)] font-medium">
                                {sub.whopEmail}
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--text-muted)]">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {sub.youtubeLink ? (
                              <div className="flex items-center gap-1">
                                <a
                                  href={sub.youtubeLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline font-medium"
                                >
                                  <Youtube className="w-3.5 h-3.5" />
                                  Link
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                                <CopyBtn text={sub.youtubeLink} />
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-muted)]">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                            {getTimeAgo(sub.queuedAt)}
                          </td>
                          <td className="py-3 pr-4">
                            <CountdownCell queuedAt={sub.queuedAt} status={sub.status} />
                          </td>
                          <td className="py-3 pr-4 text-xs text-[var(--text-muted)] whitespace-nowrap">
                            {sub.timeTaken !== null ? `${sub.timeTaken}m` : '—'}
                          </td>
                          <td className="py-3 pr-4">
                            {sub.status === 'submitted' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> Submitted
                              </span>
                            ) : sub.status === 'pending' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                                <Clock className="w-3 h-3" /> Pending
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                <XCircle className="w-3 h-3" /> Failed
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {sub.status === 'pending' ? (
                              <button
                                onClick={() => onMarkWhopSubmitted(sub.id)}
                                disabled={markingSubId === sub.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold neu-primary-button disabled:opacity-40"
                              >
                                {markingSubId === sub.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                Mark Submitted
                              </button>
                            ) : (
                              <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                                <Check className="w-3 h-3 text-emerald-500" /> Done
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Actions Menu ──────────────────────────────────────────────────────────────

function ActionsMenu({
  row,
  onDetails,
  onRerun,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  row: RunLogRow
  onDetails: () => void
  onRerun: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="neu-button w-8 h-8 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-30 w-44 neu-flat rounded-2xl shadow-xl overflow-hidden py-1 border border-[var(--border)]">
          {/* Running: Pause, Cancel, Details */}
          {row.status === 'running' && (
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  onPause()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <Pause className="w-4 h-4 text-amber-500" /> Pause
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onCancel()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-rose-500/10 transition-colors text-left"
              >
                <XCircle className="w-4 h-4 text-rose-500" /> Cancel
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDetails()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--accent)]" /> Details
              </button>
            </>
          )}

          {/* Paused: Resume, Cancel, Details */}
          {row.status === 'paused' && (
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  onResume()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-emerald-500/10 transition-colors text-left"
              >
                <Play className="w-4 h-4 text-emerald-500" /> Resume
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onCancel()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-rose-500/10 transition-colors text-left"
              >
                <XCircle className="w-4 h-4 text-rose-500" /> Cancel
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDetails()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--accent)]" /> Details
              </button>
            </>
          )}

          {/* Partial or Failed: Rerun, Details, Delete */}
          {(row.status === 'partial' || row.status === 'failed') && (
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  onRerun()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-emerald-500/10 transition-colors text-left"
              >
                <RefreshCw className="w-4 h-4 text-emerald-500" /> Rerun
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDetails()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--accent)]" /> Details
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDelete()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4 text-rose-500" /> Delete
              </button>
            </>
          )}

          {/* Success or Cancelled: Details, Delete */}
          {(row.status === 'success' || row.status === 'cancelled') && (
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  onDetails()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--accent)]" /> Details
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDelete()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4 text-rose-500" /> Delete
              </button>
            </>
          )}

          {/* Queued: Cancel, Details */}
          {row.status === 'queued' && (
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  onCancel()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-rose-500/10 transition-colors text-left"
              >
                <XCircle className="w-4 h-4 text-rose-500" /> Cancel
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onDetails()
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-[var(--accent)]" /> Details
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Channel Pills ─────────────────────────────────────────────────────────────

function ChannelPills({ channels }: { channels: ChannelRef[] }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 2
  const shown = expanded ? channels : channels.slice(0, MAX)
  const extra = channels.length - MAX

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((ch) => (
        <span
          key={ch.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium neu-pressed text-[var(--text-primary)]"
        >
          <Youtube className="w-3 h-3 text-red-500" />
          {ch.handle || ch.name}
        </span>
      ))}
      {!expanded && extra > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="px-2 py-0.5 rounded-full text-xs font-medium text-[var(--accent)] neu-pressed hover:bg-[var(--accent)]/10"
        >
          +{extra} more
        </button>
      )}
      {expanded && extra > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="px-2 py-0.5 rounded-full text-xs font-medium text-[var(--text-muted)] neu-pressed"
        >
          Show less
        </button>
      )}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function RunLogsClient() {
  const [rows, setRows] = useState<RunLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [selectedRow, setSelectedRow] = useState<RunLogRow | null>(null)
  const [rerunningId, setRerunningId] = useState<string | null>(null)
  const [markingSubId, setMarkingSubId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const handleMarkWhopSubmitted = async (whopSubmissionId: string) => {
    if (!selectedRow) return
    setMarkingSubId(whopSubmissionId)
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_whop_submitted',
          automationId: selectedRow.id,
          whopSubmissionId,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Marked as submitted to Whop!')
        // Update local state immediately
        setSelectedRow((prev) => {
          if (!prev) return null
          return {
            ...prev,
            whopSubmissions: prev.whopSubmissions.map((s) =>
              s.id === whopSubmissionId ? { ...s, status: 'submitted', timeTaken: 5 } : s
            ),
          }
        })
        fetchLogs(page)
      } else {
        showToast(data.error || 'Failed to update status', 'error')
      }
    } catch {
      showToast('Error updating Whop status', 'error')
    } finally {
      setMarkingSubId(null)
    }
  }

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchLogs = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/user/run-logs?page=${p}&limit=20`)
      const data = await res.json()
      setRows(data.rows || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
      setPage(p)

      // Keep selectedRow in sync with updated data if details modal is open
      setSelectedRow((current) => {
        if (!current) return null
        const matching = (data.rows || []).find((r: RunLogRow) => r.id === current.id)
        return matching || current
      })
    } catch {
      if (!silent) showToast('Failed to load run logs', 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(1)
  }, [fetchLogs])

  // ── Auto-poll live updates when Details Modal is open for a running/queued run ──
  useEffect(() => {
    if (!selectedRow) return
    const isOngoing = selectedRow.status === 'running' || selectedRow.status === 'queued'
    if (!isOngoing) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/user/run-logs?id=${selectedRow.id}`)
        if (res.ok) {
          const data = await res.json()
          if (data.row) {
            setSelectedRow(data.row)
            // Also sync in the parent rows list so background table reflects progress
            setRows((prev) => prev.map((r) => (r.id === data.row.id ? data.row : r)))
          }
        }
      } catch (err) {
        console.warn('Live modal polling error:', err)
      }
    }, 2500)

    return () => clearInterval(interval)
  }, [selectedRow?.id, selectedRow?.status])

  // ── Auto-poll run logs table when any row is running or queued ──
  useEffect(() => {
    const hasOngoing = rows.some((r) => r.status === 'running' || r.status === 'queued')
    if (!hasOngoing) return

    const interval = setInterval(() => {
      fetchLogs(page, true)
    }, 4000)

    return () => clearInterval(interval)
  }, [rows, page, fetchLogs])

  const handleSeedData = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_test_data' }),
      })
      const data = await res.json()
      showToast(data.message || 'Test data seeded!')
      fetchLogs(1)
    } catch {
      showToast('Seeding failed', 'error')
    } finally {
      setSeeding(false)
    }
  }

  const handleRerun = async (row: RunLogRow) => {
    setRerunningId(row.id)
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rerun', automationId: row.id }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Rerun queued successfully!')
        fetchLogs(page)
      } else {
        showToast(data.error || 'Rerun failed', 'error')
      }
    } catch {
      showToast('Rerun failed', 'error')
    } finally {
      setRerunningId(null)
    }
  }

  const handlePause = async (row: RunLogRow) => {
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', automationId: row.id }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Automation paused!')
        fetchLogs(page)
      } else {
        showToast(data.error || 'Failed to pause automation', 'error')
      }
    } catch {
      showToast('Error pausing automation', 'error')
    }
  }

  const handleResume = async (row: RunLogRow) => {
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', automationId: row.id }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Automation resumed!')
        fetchLogs(page)
      } else {
        showToast(data.error || 'Failed to resume automation', 'error')
      }
    } catch {
      showToast('Error resuming automation', 'error')
    }
  }

  const handleCancel = async (row: RunLogRow) => {
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', automationId: row.id }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Automation stopped and cancelled!')
        fetchLogs(page)
      } else {
        showToast(data.error || 'Failed to cancel automation', 'error')
      }
    } catch {
      showToast('Error cancelling automation', 'error')
    }
  }

  const handleDelete = async (row: RunLogRow) => {
    if (!window.confirm('Are you sure you want to delete this automation run record?')) return
    try {
      const res = await fetch('/api/user/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', automationId: row.id }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Automation record deleted!')
        fetchLogs(page)
      } else {
        showToast(data.error || 'Failed to delete automation', 'error')
      }
    } catch {
      showToast('Error deleting automation', 'error')
    }
  }

  return (
    <div className="p-6 space-y-6 min-h-screen">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-emerald-500 text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Run Logs</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Automation execution history &bull;{' '}
            <span className="font-semibold text-[var(--accent)]">{total}</span> total runs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchLogs(page)}
            disabled={loading}
            className="neu-primary-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table Card */}
      <div className="neu-flat rounded-3xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="neu-pressed w-16 h-16 rounded-2xl flex items-center justify-center">
              <Clock className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <div className="text-center">
              <p className="text-[var(--text-primary)] font-semibold">No runs yet</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Automation runs will automatically appear here once triggered.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {[
                    'Triggered At',
                    'Channels',
                    'Campaign',
                    'Subcampaign(s)',
                    'Active Slots',
                    'Status',
                    'Action',
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-[var(--text-muted)] px-5 py-4 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/5 transition-colors group"
                  >
                    {/* Triggered At */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="text-xs font-medium text-[var(--text-primary)]">
                        {formatDatetime(row.triggeredAt)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">
                        {getTimeAgo(row.triggeredAt)}
                      </div>
                    </td>

                    {/* Channels */}
                    <td className="px-5 py-4">
                      <ChannelPills channels={row.channels} />
                    </td>

                    {/* Campaign */}
                    <td className="px-5 py-4">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        {row.campaign?.name || <span className="text-[var(--text-muted)]">—</span>}
                      </span>
                    </td>

                    {/* Subcampaigns — using run name segments */}
                    <td className="px-5 py-4">
                      <span className="text-xs text-[var(--text-muted)]">—</span>
                    </td>

                    {/* Active Slots */}
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full neu-pressed text-xs font-bold text-[var(--accent)]">
                        {row.activeSlots}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">
                      <StatusBadge status={row.status} />
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4">
                      <ActionsMenu
                        row={row}
                        onDetails={() => setSelectedRow(row)}
                        onRerun={() => handleRerun(row)}
                        onPause={() => handlePause(row)}
                        onResume={() => handleResume(row)}
                        onCancel={() => handleCancel(row)}
                        onDelete={() => handleDelete(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border)]">
            <p className="text-xs text-[var(--text-muted)]">
              Page {page} of {totalPages} &bull; {total} total runs
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchLogs(page - 1)}
                disabled={page <= 1 || loading}
                className="neu-button w-8 h-8 flex items-center justify-center rounded-xl text-[var(--text-muted)] disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page <= 3 ? i + 1 : page - 2 + i
                if (pg < 1 || pg > totalPages) return null
                return (
                  <button
                    key={pg}
                    onClick={() => fetchLogs(pg)}
                    className={`w-8 h-8 flex items-center justify-center rounded-xl text-xs font-semibold transition-all ${
                      pg === page
                        ? 'neu-pressed text-[var(--accent)]'
                        : 'neu-button text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {pg}
                  </button>
                )
              })}
              <button
                onClick={() => fetchLogs(page + 1)}
                disabled={page >= totalPages || loading}
                className="neu-button w-8 h-8 flex items-center justify-center rounded-xl text-[var(--text-muted)] disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedRow && (
        <DetailsModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onMarkWhopSubmitted={handleMarkWhopSubmitted}
          markingSubId={markingSubId}
        />
      )}
    </div>
  )
}
