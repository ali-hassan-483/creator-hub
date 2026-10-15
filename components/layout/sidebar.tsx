'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Globe,
  Megaphone,
  DollarSign,
  Tv,
  Zap,
  Clock,
  BarChart2,
  ClipboardList,
  Key,
  Bot,
  MessageSquare,
  Settings,
  LogOut,
  ChevronRight,
  ShieldCheck,
  PlaySquare,
  FileText,
  ShoppingBag
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

const adminNav: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
  { href: '/admin/users', label: 'Users', icon: <Users size={17} /> },
  { href: '/admin/whop-accounts', label: 'Whop Accounts', icon: <ShoppingBag size={17} /> },
  { href: '/admin/ip-management', label: 'IP Management', icon: <Globe size={17} /> },
  { href: '/admin/campaigns', label: 'Campaigns', icon: <Megaphone size={17} /> },
  { href: '/admin/sandbox-test', label: 'Sandbox Test', icon: <PlaySquare size={17} className="text-emerald-500" /> },
  { href: '/admin/earnings', label: 'Earnings', icon: <DollarSign size={17} /> },
  { href: '/admin/settings', label: 'Settings', icon: <Settings size={17} /> },
]

// Matching user's screenshot sidebar exactly:
// Dashboard, Channels, Campaigns, Credentials, Run Automation, Sandbox Test, Run Logs, Pending Tasks, Analytics, Proxy Settings
const userNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} className="text-amber-500" /> },
  { href: '/channels', label: 'Channels', icon: <Tv size={17} className="text-sky-500" /> },
  { href: '/campaigns', label: 'Campaigns', icon: <Megaphone size={17} className="text-rose-500" /> },
  { href: '/credentials', label: 'Credentials', icon: <Key size={17} className="text-purple-500" /> },
  { href: '/run-automation', label: 'Run Automation', icon: <Zap size={17} className="text-pink-500" /> },
  { href: '/scheduled', label: 'Run Logs', icon: <FileText size={17} className="text-cyan-500" /> },
  { href: '/pending-tasks', label: 'Pending Tasks', icon: <ClipboardList size={17} className="text-amber-500" /> },
  { href: '/analytics', label: 'Analytics', icon: <BarChart2 size={17} className="text-blue-500" /> },
  { href: '/settings', label: 'Proxy Settings', icon: <Globe size={17} className="text-indigo-500" /> },
]

interface SidebarProps {
  role: 'admin' | 'user'
  userName?: string | null
  userEmail?: string | null
}

export function Sidebar({ role, userName, userEmail }: SidebarProps) {
  const pathname = usePathname()
  const nav = role === 'admin' ? adminNav : userNav

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-[#f0f3f8] dark:bg-[#151922] border-r border-[#dbe0ea] dark:border-white/5 select-none">
      {/* Brand Logo with Neumorphic Touch */}
      <div className="px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-md">
            <span className="font-extrabold text-sm tracking-wider">CP</span>
          </div>
          <span className="text-base font-extrabold text-[#2b3345] dark:text-[#f1f5f9] tracking-tight">
            Clipping Portal
          </span>
        </Link>
        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400">
          {role}
        </span>
      </div>

      {/* Navigation Links (Neumorphic Buttons) */}
      <nav className="flex-1 px-4 py-3 space-y-2 overflow-y-auto">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all group',
                active
                  ? 'neu-pressed text-purple-600 dark:text-purple-400 font-bold'
                  : 'neu-button text-[#495470] dark:text-[#cbd5e1] hover:text-[#2b3345] dark:hover:text-white'
              )}
            >
              <div className="shrink-0">{item.icon}</div>
              <span className="flex-1 truncate">{item.label}</span>
              {active && <div className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400" />}
            </Link>
          )
        })}
      </nav>

      {/* User profile & Log out */}
      <div className="p-4 border-t border-[#dbe0ea] dark:border-white/5">
        <div className="neu-flat rounded-2xl p-3 flex items-center justify-between">
          <div className="truncate mr-2">
            <p className="text-xs font-bold text-[#2b3345] dark:text-[#f1f5f9] truncate">
              {userName || 'User'}
            </p>
            <p className="text-[10px] text-[#718096] dark:text-[#94a3b8] truncate">
              {userEmail || 'user'}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="neu-button px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 shrink-0"
            title="Log Out"
          >
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
