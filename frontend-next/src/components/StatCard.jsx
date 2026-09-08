// KpiTile internals behind the same StatCard prop contract as the old
// app: { title, value, sub, icon, color }, plus an optional href that turns the
// tile into a link to whatever the figure counts. The color prop only tints the
// icon well using the semantic status pairs (blue→info, green→ok, yellow→warn,
// red→danger, teal/purple→accent). No gradients.
import Link from 'next/link'
import { Icon } from './icons'

const wells = {
  blue:   'bg-info-tint text-info',
  green:  'bg-ok-tint text-ok',
  yellow: 'bg-warn-tint text-warn',
  red:    'bg-danger-tint text-danger',
  teal:   'bg-accent-tint text-accent',
  purple: 'bg-accent-tint text-accent', // legacy alias kept for prop parity
}

export default function StatCard({ title, value, sub, icon, color = 'blue', href }) {
  const well = wells[color] ?? wells.blue

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-2">{title}</p>
        {icon && (
          <span
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${well}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      <p className="num kpi-value font-semibold leading-tight mt-1 text-ink">{value ?? '—'}</p>
      {sub && (
        <p className="text-[13px] text-ink-3 mt-1 flex items-center gap-1">
          {sub}
          {href && <Icon name="chevronRight" size={13} stroke={1.75} />}
        </p>
      )}
    </>
  )

  // A tile with an href is a link to the records behind the figure. It keeps
  // the same markup so the .kpi-tile hover lift applies either way.
  return href
    ? <Link href={href} className="panel p-5 kpi-tile block">{body}</Link>
    : <div className="panel p-5 kpi-tile">{body}</div>
}
