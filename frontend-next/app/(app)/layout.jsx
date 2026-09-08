'use client'

// The authenticated shell + auth gate. Reproduces ProtectedRoute.jsx exactly:
// while auth resolves → loading state; no user → redirect to /login; else the
// shell. Drawer mechanics match the old app (off-canvas below lg, overlay,
// closes on outside click / nav / Esc — Esc closing is new).
//
// Premium pass: a ⌘K command palette lives here so it's reachable from every
// page; the topbar carries its trigger. The canvas is left transparent so the
// paper texture on <body> shows through.
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/src/contexts/AuthContext'
import { useTheme } from '@/src/contexts/ThemeContext'
import Sidebar from '@/src/components/Sidebar'
import CommandPalette, { SearchTrigger, useCommandPalette } from '@/src/components/CommandPalette'
import { Icon } from '@/src/components/icons'
import { PageLoader } from '@/src/components/Skeleton'
import { SCHOOL_NAME, SCHOOL_INITIAL } from '@/src/brand'

function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="btn btn-ghost px-2.5"
    >
      <Icon name={dark ? 'sun' : 'moon'} size={18} stroke={1.75} />
    </button>
  )
}

export default function AppLayout({ children }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const palette = useCommandPalette()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  // Esc closes the mobile drawer.
  useEffect(() => {
    if (!sidebarOpen) return
    const handler = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sidebarOpen])

  if (loading) {
    // PARITY: ProtectedRoute showed a centered loading state while auth
    // resolved. Same gate, now the branded ruled-lines loader.
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageLoader />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay — flat dim, no blur */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-[rgba(18,24,19,0.45)] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: 240px, drawer below lg */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 transform transition-transform duration-[240ms] ease-out
          lg:relative lg:translate-x-0 lg:shrink-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar: 56px, flat, border-b */}
        <header className="h-14 shrink-0 bg-surface border-b border-edge flex items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="btn btn-ghost px-2.5 lg:hidden"
            >
              <Icon name="menu" size={20} stroke={1.75} />
            </button>
            <span className="font-display text-[15px] font-medium text-ink lg:hidden truncate">
              {SCHOOL_NAME}
            </span>
            <SearchTrigger onClick={() => palette.setOpen(true)} />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => palette.setOpen(true)}
              aria-label="Search"
              title="Search (Ctrl K)"
              className="btn btn-ghost px-2.5 md:hidden"
            >
              <Icon name="search" size={18} stroke={1.75} />
            </button>
            <ThemeToggle />
            <UserChip />
          </div>
        </header>

        {/* Scrollable canvas — transparent so the paper texture shows through */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </div>
  )
}

function UserChip() {
  const { user } = useAuth()
  return (
    <span className="hidden sm:flex items-center gap-2 pl-2 pr-3 h-9 rounded-control text-[13px] text-ink-2">
      <span
        className="w-7 h-7 rounded-full bg-accent-tint text-accent flex items-center justify-center text-[12px] font-semibold"
        aria-hidden="true"
      >
        {SCHOOL_INITIAL}
      </span>
      {user?.username}
    </span>
  )
}
