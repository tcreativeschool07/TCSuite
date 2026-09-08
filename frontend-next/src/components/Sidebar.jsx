'use client'

// App sidebar: 240px, flat --surface, border-r, follows the theme (the
// old permanently-dark navy panel is gone). Same ten destinations as the old
// Sidebar.jsx, same icon set at stroke 1.75.
//
// Premium pass: the active highlight is one shared element that glides between
// items (framer `layoutId`) instead of blinking from one to the next.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { SCHOOL_NAME, SCHOOL_INITIAL } from '../brand'
import { Icon } from './icons'

const navItems = [
  { to: '/',                  icon: 'home',       label: 'Dashboard' },
  { to: '/students',          icon: 'students',   label: 'Students' },
  { to: '/classes',           icon: 'building',   label: 'Classes' },
  { to: '/fees',              icon: 'chart',      label: 'Fee dashboard' },
  { to: '/fees/records',      icon: 'card',       label: 'Fee records' },
  { to: '/fees/structures',   icon: 'calculator', label: 'Fee structures' },
  { to: '/balance-sheet',     icon: 'report',     label: 'Balance sheet' },
  { to: '/academic-years',    icon: 'calendar',   label: 'Academic years' },
  { to: '/misc-charges',      icon: 'plus',       label: 'Misc. charges' },
  { to: '/charge-categories', icon: 'tag',        label: 'Charge categories' },
]

export default function Sidebar({ onClose }) {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const reduced = useReducedMotion()

  // PARITY: the old React Router NavLink used prefix matching, which lit up
  // both "Fee dashboard" (/fees) and "Fee records" (/fees/records) at once on
  // /fees/records. Here only the longest matching path is active — one item
  // highlighted at a time; every match the old app showed is still covered.
  const activeTo = navItems.reduce((best, item) => {
    const matches = pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to + '/'))
    if (!matches) return best
    return !best || item.to.length > best.length ? item.to : best
  }, null)

  const glide = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 520, damping: 42, mass: 0.6 }

  return (
    <div className="flex flex-col h-full bg-surface border-r border-edge">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-rule">
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-lg bg-accent-tint text-accent flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Icon name="crest" size={20} stroke={1.6} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[17px] font-medium leading-tight text-ink truncate">
              {SCHOOL_NAME}
            </p>
            <p className="text-[12.5px] text-ink-3 mt-0.5">Management system</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => {
          const isActive = item.to === activeTo
          return (
            <Link
              key={item.to}
              href={item.to}
              onClick={onClose}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex items-center gap-3 h-9 px-3 rounded-control text-[13.5px] font-medium transition-colors duration-120 ${
                isActive ? 'text-accent' : 'text-ink-2 hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              {isActive && (
                <>
                  <motion.span
                    layoutId="nav-active-fill"
                    transition={glide}
                    className="absolute inset-0 rounded-control bg-accent-tint"
                    aria-hidden="true"
                  />
                  <motion.span
                    layoutId="nav-active-bar"
                    transition={glide}
                    className="absolute -left-3 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r-full"
                    aria-hidden="true"
                  />
                </>
              )}
              <span className="relative flex items-center gap-3">
                <Icon name={item.icon} size={18} stroke={1.75} />
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-edge">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            className="w-8 h-8 rounded-full bg-accent-tint text-accent flex items-center justify-center text-[13px] font-semibold shrink-0"
            aria-hidden="true"
          >
            {SCHOOL_INITIAL}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-medium text-ink truncate">{user?.username}</p>
            <p className="text-[12px] text-ink-3">{user?.is_staff ? 'Staff' : 'Admin'}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="btn btn-ghost btn-sm px-2"
          >
            <Icon name="logout" size={16} stroke={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
