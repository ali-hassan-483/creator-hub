'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  Eye,
  ExternalLink,
  Copy,
  Check,
  Send,
  Loader2,
  Youtube,
  XCircle,
  Filter,
  RefreshCw,
  AlertCircle,
  DollarSign,
  Calendar,
  Sparkles,
  Edit2
} from 'lucide-react'

interface CampaignOption {
  id: string
  name: string
  minViews: number | null
}

interface PendingTaskItem {
  id: string
  campaignId: string
  campaignName: string
  channelId: string
  channelName: string
  channelEmail: string
  whopEmail: string
  videoId: string
  videoTitle: string
  viewCount: number
  status: 'pending' | 'requirements_completed' | 'ready_for_review' | 'approved' | 'rejected'
  stageLabel: string
  requirementsData: any
  earningAmount?: number | null
  publishedAt?: string | null
  notes: string | null
  createdAt: string
  reviewedAt: string | null
}

const STAGES = [
  { value: 'all', label: 'All Stages' },
  { value: 'eligible_for_review', label: 'Eligible for Review' },
  { value: 'analytics_required', label: 'Analytics Required' },
  { value: 'analytics_submitted', label: 'Analytics Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

export default function PendingTasksClient() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [tasks, setTasks] = useState<PendingTaskItem[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all')
  const [selectedStage, setSelectedStage] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // 💰 Approval Modal State
  const [approvingTask, setApprovingTask] = useState<PendingTaskItem | null>(null)
  const [earningInput, setEarningInput] = useState<string>('')
  const [earningNotes, setEarningNotes] = useState<string>('')
  const [actionLoading, setActionLoading] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (selectedCampaign !== 'all') params.set('campaignId', selectedCampaign)
      if (selectedStage !== 'all') params.set('stage', selectedStage)

      const res = await fetch(`/api/user/pending-tasks?${params.toString()}`)
      const data = await res.json()
      if (data.campaigns) setCampaigns(data.campaigns)
      if (data.tasks) setTasks(data.tasks)
    } catch (err) {
      console.error(err)
      showToast('Failed to load pending tasks', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedCampaign, selectedStage])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleToggleYtMention = async (taskId: string, ytMentioned: boolean) => {
    try {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, requirementsData: { ...(t.requirementsData || {}), ytMentioned } }
            : t
        )
      )

      const res = await fetch('/api/user/pending-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_yt_mention', taskId, ytMentioned }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(ytMentioned ? 'Marked as mentioned on YouTube' : 'Marked as not mentioned')
      } else {
        showToast(data.error || 'Failed to update', 'error')
        fetchTasks()
      }
    } catch {
      showToast('Error updating mention status', 'error')
      fetchTasks()
    }
  }

  const handleUpdateStage = async (taskId: string, targetStatus: string) => {
    try {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus as any } : t))
      )

      const res = await fetch('/api/user/pending-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_stage', taskId, targetStatus }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Stage status updated!')
      } else {
        showToast(data.error || 'Failed to update stage', 'error')
        fetchTasks()
      }
    } catch {
      showToast('Error updating stage', 'error')
      fetchTasks()
    }
  }

  // Open Approval Modal
  const openApproveModal = (task: PendingTaskItem) => {
    setApprovingTask(task)
    setEarningInput(task.earningAmount ? String(task.earningAmount) : '')
    setEarningNotes(task.notes || '')
  }

  // Submit Approval with Earnings
  const handleConfirmApproval = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!approvingTask) return

    const amount = parseFloat(earningInput.trim())
    if (isNaN(amount) || amount < 0) {
      showToast('Please enter a valid positive earning amount ($)', 'error')
      return
    }

    setActionLoading(true)
    try {
      const res = await fetch('/api/user/pending-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_task',
          taskId: approvingTask.id,
          earningAmount: amount,
          notes: earningNotes.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to approve task')

      showToast(`✅ Video approved! $${amount.toFixed(2)} added to your balance.`)
      setApprovingTask(null)
      fetchTasks()
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // Reject Task
  const handleRejectTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to mark this video as Rejected?')) return

    try {
      const res = await fetch('/api/user/pending-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject_task',
          taskId,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reject task')

      showToast('Task marked as Rejected')
      fetchTasks()
    } catch (err: any) {
      showToast(err.message, 'error')
    }
  }

  // Summary Metrics
  const totalApproved = tasks.filter((t) => t.status === 'approved').length
  const totalEarned = tasks
    .filter((t) => t.status === 'approved')
    .reduce((acc, t) => acc + (t.earningAmount || 0), 0)
  const totalPending = tasks.filter((t) => t.status !== 'approved' && t.status !== 'rejected').length

  const formatVideoDate = (iso?: string | null) => {
    if (!iso) return 'Recent'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="p-6 space-y-6 min-h-screen max-w-7xl mx-auto">
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Pending Tasks</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Videos meeting campaign view thresholds. Review proof, approve payouts, and manage earnings.
          </p>
        </div>
        <button
          onClick={() => fetchTasks()}
          disabled={loading}
          className="neu-primary-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="neu-flat rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
              Qualifying Videos
            </span>
            <span className="text-2xl font-bold text-[var(--text-primary)] mt-1 block">
              {tasks.length}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
            <ClipboardList size={20} />
          </div>
        </div>

        <div className="neu-flat rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
              Approved ({totalApproved})
            </span>
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
              ${totalEarned.toFixed(2)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="neu-flat rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
              Awaiting Review
            </span>
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 block">
              {totalPending}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
            <Clock size={20} />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="neu-flat rounded-2xl p-4 flex flex-wrap items-center gap-4">
        {/* Campaign Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Campaign:</span>
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none min-w-[200px]"
          >
            <option value="all">All Campaigns</option>
            {campaigns.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Stage Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Stage:</span>
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none min-w-[170px]"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-xs text-[var(--text-muted)]">
          Showing <span className="font-bold text-[var(--accent)]">{tasks.length}</span> videos
        </div>
      </div>

      {/* Main Table */}
      <div className="neu-flat rounded-3xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="neu-pressed w-16 h-16 rounded-2xl flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <div className="text-center">
              <p className="text-[var(--text-primary)] font-semibold">No Videos In This Filter</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Videos meeting campaign view thresholds will appear here automatically.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-muted/30">
                  <th className="text-left font-semibold text-[var(--text-muted)] px-4 py-3.5 whitespace-nowrap">
                    Video & Channel
                  </th>
                  <th className="text-left font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Uploaded Date
                  </th>
                  <th className="text-left font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Campaign
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Views at Trigger
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    YouTube Mentioned
                  </th>
                  <th className="text-center font-semibold text-[var(--text-muted)] px-3 py-3.5 whitespace-nowrap">
                    Stage Status
                  </th>
                  <th className="text-right font-semibold text-[var(--text-muted)] px-4 py-3.5 whitespace-nowrap">
                    Actions (Approval & Payout)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/40">
                {tasks.map((task) => {
                  const ytUrl = task.videoId ? `https://youtube.com/watch?v=${task.videoId}` : null
                  const isMentioned = Boolean(task.requirementsData?.ytMentioned)

                  return (
                    <tr
                      key={task.id}
                      className="hover:bg-[var(--accent)]/5 transition-colors"
                    >
                      {/* Video & Channel */}
                      <td className="px-4 py-3 max-w-sm">
                        <div className="font-semibold text-xs text-[var(--text-primary)] line-clamp-1" title={task.videoTitle}>
                          {task.videoTitle}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-[var(--text-primary)] font-semibold">{task.channelName}</span>
                          {ytUrl && (
                            <div className="flex items-center gap-1">
                              <a
                                href={ytUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline font-medium"
                              >
                                <Youtube className="w-3.5 h-3.5 text-red-500" />
                                Watch
                              </a>
                              <button
                                onClick={() => handleCopy(task.id, ytUrl)}
                                className="text-[var(--text-muted)] hover:text-[var(--accent)] p-0.5 rounded"
                                title="Copy YouTube link"
                              >
                                {copiedId === task.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                        {/* Channel Email & Whop Email */}
                        <div className="flex flex-col gap-0.5 mt-1 text-[10px] text-[var(--text-muted)] font-mono">
                          <div>
                            <span className="opacity-70 uppercase tracking-wider text-[9px] mr-1">Email:</span>
                            <span>{task.channelEmail || '—'}</span>
                          </div>
                          <div>
                            <span className="opacity-70 uppercase tracking-wider text-[9px] mr-1">Whop:</span>
                            <span className="text-purple-600 dark:text-purple-400 font-semibold">{task.whopEmail || '—'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Video Uploaded Date */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                          <Calendar size={13} className="text-primary/70" />
                          <span>{formatVideoDate(task.publishedAt || task.createdAt)}</span>
                        </div>
                      </td>

                      {/* Campaign */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{task.campaignName}</span>
                      </td>

                      {/* Views at Trigger */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold neu-pressed text-[var(--accent)]">
                          <Eye className="w-3 h-3" />
                          {task.viewCount.toLocaleString()}
                        </span>
                      </td>

                      {/* YouTube Mentioned Dropdown */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <select
                          value={isMentioned ? 'yes' : 'no'}
                          onChange={(e) => handleToggleYtMention(task.id, e.target.value === 'yes')}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold neu-pressed focus:outline-none transition-colors ${
                            isMentioned
                              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          <option value="yes">Mentioned (Yes)</option>
                          <option value="no">Not Mentioned (No)</option>
                        </select>
                      </td>

                      {/* Stage Status Dropdown (Review progression only: Approve & Reject moved to Actions!) */}
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <select
                          value={
                            task.status === 'approved' || task.status === 'rejected'
                              ? 'ready_for_review'
                              : task.status
                          }
                          disabled={task.status === 'approved' || task.status === 'rejected'}
                          onChange={(e) => handleUpdateStage(task.id, e.target.value)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold neu-pressed focus:outline-none transition-colors ${
                            task.status === 'ready_for_review'
                              ? 'text-blue-600 dark:text-blue-400 font-bold'
                              : task.status === 'requirements_completed'
                              ? 'text-purple-600 dark:text-purple-400 font-bold'
                              : 'text-amber-600 dark:text-amber-400 font-bold'
                          }`}
                        >
                          <option value="pending">Eligible for Review</option>
                          <option value="requirements_completed">Analytics Required</option>
                          <option value="ready_for_review">Analytics Submitted</option>
                        </select>
                      </td>

                      {/* Prominent Action Column: Approve & Reject at the Front */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {task.status === 'approved' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={13} />
                              Approved {task.earningAmount !== null && task.earningAmount !== undefined ? `($${Number(task.earningAmount).toFixed(2)})` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => openApproveModal(task)}
                              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit Earning Amount"
                            >
                              <Edit2 size={12} />
                            </button>
                          </div>
                        ) : task.status === 'rejected' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                              <XCircle size={13} />
                              Rejected
                            </span>
                            <button
                              type="button"
                              onClick={() => openApproveModal(task)}
                              className="text-[11px] font-semibold text-primary hover:underline ml-1"
                            >
                              Re-approve
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openApproveModal(task)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors"
                            >
                              <Check size={13} strokeWidth={3} />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectTask(task.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors"
                            >
                              <XCircle size={13} />
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 💰 APPROVAL & EARNING MODAL */}
      {approvingTask && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center font-bold">
                  <DollarSign size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground">Approve Video & Record Earning</h3>
                  <p className="text-[11px] text-muted-foreground">Credits user balance and marks task approved</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setApprovingTask(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Video Snapshot */}
            <div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1">
              <p className="text-xs font-semibold text-foreground line-clamp-1">{approvingTask.videoTitle}</p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{approvingTask.channelName}</span>
                <span className="font-bold text-primary">{approvingTask.viewCount.toLocaleString()} views</span>
              </div>
            </div>

            <form onSubmit={handleConfirmApproval} className="space-y-4">
              {/* Earning Amount Input */}
              <div>
                <label className="block text-xs font-bold text-foreground mb-1.5">
                  How much did this video earn? ($ USD) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 50.00"
                    required
                    value={earningInput}
                    onChange={(e) => setEarningInput(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm font-bold bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-foreground"
                    autoFocus
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Yeh amount user balance mein add ho kar Dashboard aur Admin earnings mein show hogi.
                </p>
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Whop payout verified"
                  value={earningNotes}
                  onChange={(e) => setEarningNotes(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApprovingTask(null)}
                  className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors"
                >
                  {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                  Confirm & Approve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
