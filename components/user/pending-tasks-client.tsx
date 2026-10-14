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
  AlertCircle
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
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [proofInputs, setProofInputs] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
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
      // Optimistic update
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
      // Optimistic update
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Pending Tasks</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Videos meeting campaign view thresholds awaiting verification and review
          </p>
        </div>
        <button
          onClick={() => fetchTasks()}
          disabled={loading}
          className="neu-primary-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* 2 Dropdown Filter Toolbar: 1st Campaign, 2nd Stage */}
      <div className="neu-flat rounded-2xl p-4 flex flex-wrap items-center gap-4">
        {/* Campaign Dropdown */}
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

        {/* Stage Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Stage:</span>
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold text-[var(--text-primary)] focus:outline-none min-w-[180px]"
          >
            {STAGES.map((stg) => (
              <option key={stg.value} value={stg.value}>
                {stg.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-xs text-[var(--text-muted)]">
          Showing <span className="font-bold text-[var(--accent)]">{tasks.length}</span> videos
        </div>
      </div>

      {/* Task List Table */}
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
              <p className="text-[var(--text-primary)] font-semibold">No Videos In This Stage</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Videos that reach view thresholds in the 6-hour Analytics cycle will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {['Video & Channel', 'Campaign', 'Views at Trigger', 'YouTube Mentioned', 'Stage Status'].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-[var(--text-muted)] px-5 py-4 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const ytUrl = task.videoId ? `https://youtube.com/watch?v=${task.videoId}` : null
                  const isMentioned = Boolean(task.requirementsData?.ytMentioned)

                  return (
                    <tr
                      key={task.id}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--accent)]/5 transition-colors"
                    >
                      {/* Video & Channel */}
                      <td className="px-5 py-4 max-w-sm">
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
                                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline font-medium"
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
                        <div className="flex flex-col gap-0.5 mt-1.5 text-[11px] text-[var(--text-muted)]">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-[10px] uppercase tracking-wider text-[var(--text-muted)] opacity-75">Email:</span>
                            <span className="font-mono">{task.channelEmail || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-[10px] uppercase tracking-wider text-[var(--text-muted)] opacity-75">Whop:</span>
                            <span className="font-mono text-purple-600 dark:text-purple-400 font-medium">{task.whopEmail || '—'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Campaign */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{task.campaignName}</span>
                      </td>

                      {/* Views at Trigger */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold neu-pressed text-[var(--accent)]">
                          <Eye className="w-3 h-3" />
                          {task.viewCount.toLocaleString()} views
                        </span>
                      </td>

                      {/* YouTube Mentioned Dropdown */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <select
                          value={isMentioned ? 'yes' : 'no'}
                          onChange={(e) => handleToggleYtMention(task.id, e.target.value === 'yes')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold neu-pressed focus:outline-none transition-colors ${
                            isMentioned
                              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          <option value="yes">Mentioned (Yes)</option>
                          <option value="no">Not Mentioned (No)</option>
                        </select>
                      </td>

                      {/* Stage Status Dropdown */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <select
                          value={task.status}
                          onChange={(e) => handleUpdateStage(task.id, e.target.value)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold neu-pressed focus:outline-none transition-colors ${
                            task.status === 'ready_for_review'
                              ? 'text-blue-600 dark:text-blue-400 font-bold'
                              : task.status === 'requirements_completed'
                              ? 'text-purple-600 dark:text-purple-400 font-bold'
                              : task.status === 'approved'
                              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                              : task.status === 'rejected'
                              ? 'text-rose-600 dark:text-rose-400 font-bold'
                              : 'text-amber-600 dark:text-amber-400 font-bold'
                          }`}
                        >
                          <option value="pending">Eligible for Review</option>
                          <option value="requirements_completed">Analytics Required</option>
                          <option value="ready_for_review">Analytics Submitted</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
