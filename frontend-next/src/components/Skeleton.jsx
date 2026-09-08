import { Icon } from './icons'
// Skeleton loading blocks — replace the old centered page spinners.
// Blocks match the final layout's dimensions so there is no CLS.
// Reduced-motion users get static blocks (globals.css kills the pulse).
export function Skeleton({ className = '', delay = 0 }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={delay ? { '--sk-delay': `${delay}ms` } : undefined}
      aria-hidden="true"
    />
  )
}

// The branded page loader: three ledger lines being ruled in sequence.
// Used where a whole view is gated on one async step (auth resolution).
export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-label={label}>
      <div className="loader-rule" aria-hidden="true">
        <span /><span /><span />
      </div>
      <p className="text-[13px] text-ink-3">{label}</p>
    </div>
  )
}

export function KpiGridSkeleton({ count = 4 }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${
      count >= 5 ? 'lg:grid-cols-3 xl:grid-cols-5' : 'xl:grid-cols-4'
    }`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-5">
          <Skeleton className="h-4 w-24" delay={i * 90} />
          <Skeleton className="h-8 w-32 mt-2" delay={i * 90} />
          <Skeleton className="h-3.5 w-20 mt-2" delay={i * 90} />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 6 }) {
  return (
    <div className="p-4" aria-label="Loading" role="status">
      <div className="flex gap-4 pb-3 border-b border-edge">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-3.5 border-b border-rule last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" delay={r * 70} />
          ))}
        </div>
      ))}
    </div>
  )
}

// Empty states are invitations to act: one plain sentence + one
// useful action. No illustrations, no emoji.
export function EmptyState({ message, action, icon = 'report' }) {
  return (
    <div className="py-14 px-6 text-center rise-in">
      <span
        className="mx-auto mb-4 w-11 h-11 rounded-lg bg-surface-sunken text-ink-3 flex items-center justify-center"
        aria-hidden="true"
      >
        <Icon name={icon} size={20} stroke={1.5} />
      </span>
      <p className="text-[15px] text-ink-2">{message}</p>
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  )
}
