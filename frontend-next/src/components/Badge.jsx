// PARITY: the value → variant mapping is identical to the old
// frontend/src/components/Badge.jsx — fee-status logic untouched.
// Only the visual classes behind each variant changed.
const variants = {
  paid:     'badge-ok',
  partial:  'badge-warn',
  unpaid:   'badge-danger',
  advance:  'badge-info',
  waived:   'badge-neutral',
  yes:      'badge-danger',
  no:       'badge-ok',
  active:   'badge-info',
  inactive: 'badge-neutral',
  late:     'badge-warn',
  default:  'badge-neutral',
}

export default function Badge({ value, label, title }) {
  const cls = variants[value] ?? variants.default
  return (
    <span className={`badge ${cls}`} title={title}>
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
      {label ?? value}
    </span>
  )
}
