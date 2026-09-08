'use client'

// Dashboard. Same three data sources as the old pages/Dashboard.jsx,
// except the headcount now comes from /students/stats/ instead of measuring the
// full (unpaginated) student list, and one failed call no longer voids the rest.
// New: KPI count-up + one top-to-bottom table sweep on first load,
// quick actions as a panel of secondary buttons (replaces emoji gradient
// cards — same destinations), defaulter rows flagged in the ledger table.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { getStudentStats } from '@/src/api/studentsApi'
import { getFeeSummary, getTopDefaulters } from '@/src/api/feesApi'
import StatCard from '@/src/components/StatCard'
import Badge from '@/src/components/Badge'
import CountUp from '@/src/components/CountUp'
import { Icon } from '@/src/components/icons'
import { KpiGridSkeleton, TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const rs = (v) => `Rs ${Number(v).toLocaleString()}`
const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : String(n))

const quickActions = [
  { path: '/students/new',    label: 'Enrol new student', icon: 'plus' },
  { path: '/classes',         label: 'Manage classes',    icon: 'building' },
  { path: '/fees',            label: 'Fee dashboard',     icon: 'chart' },
  { path: '/fees/records',    label: 'Fee records',       icon: 'card' },
  { path: '/fees/structures', label: 'Fee structures',    icon: 'calculator' },
  { path: '/academic-years', label: 'Academic years',    icon: 'calendar' },
]

export default function Dashboard() {
  const [stats, setStats]     = useState(null)
  const [recent, setRecent]   = useState([])
  const [loading, setLoading] = useState(true)
  const reduced = useReducedMotion()

  useEffect(() => {
    const now = new Date()
    // allSettled, not all: one failing call must not blank every KPI tile.
    Promise.allSettled([
      getStudentStats(),
      getFeeSummary({ month: now.getMonth() + 1, year: now.getFullYear() }),
      getTopDefaulters({ limit: 10 }),
    ])
      .then(([studRes, sumRes, defaultersRes]) => {
        const studentData = studRes.status === 'fulfilled' ? studRes.value.data : null
        const summaryData = sumRes.status === 'fulfilled' ? sumRes.value.data : null
        setStats({
          totalStudents: studentData?.active ?? null,
          ...(summaryData ?? {}),
        })
        setRecent(defaultersRes.status === 'fulfilled' ? defaultersRes.value.data : [])
      })
      .finally(() => setLoading(false))
  }, [])

  const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-[13px] text-ink-3 mt-1">{month} overview</p>
      </div>

      {/* KPI grid */}
      {loading ? (
        <KpiGridSkeleton count={5} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <StatCard
            title="Total students"
            value={<CountUp value={stats?.totalStudents ?? null} />}
            sub="Enrolled"
            color="blue"
            icon={<Icon name="students" size={18} />}
          />
          <StatCard
            title="This month's fees"
            value={
              stats?.total_current_fee != null
                ? <CountUp value={Number(stats.total_current_fee)} format={(v) => rs(v)} />
                : '—'
            }
            sub={
              stats?.total_previous_balance
                ? `Excludes ${rs(stats.total_previous_balance)} arrears`
                : 'Excludes arrears'
            }
            color="yellow"
            icon={<Icon name="tag" size={18} />}
          />
          <StatCard
            title="Total collected"
            value={
              stats?.total_collected != null
                ? <CountUp value={Number(stats.total_collected)} format={(v) => rs(v)} />
                : '—'
            }
            sub="This month"
            color="green"
            icon={<Icon name="card" size={18} />}
          />
          <StatCard
            title="Outstanding balance"
            value={
              stats?.total_balance != null
                ? <CountUp value={Number(stats.total_balance)} format={(v) => rs(v)} />
                : '—'
            }
            sub="Pending dues"
            color="red"
            icon={<Icon name="report" size={18} />}
          />
          <StatCard
            title="Fully paid"
            value={<CountUp value={stats?.paid_count ?? null} />}
            sub="Records this month"
            color="teal"
            icon={<Icon name="calculator" size={18} />}
          />
        </div>
      )}

      {/* Quick actions */}
      <div className="panel">
        <div className="px-5 pt-4 pb-3 border-b border-rule">
          <h2 className="text-[16px] font-semibold text-ink">Quick actions</h2>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Link key={a.path} href={a.path} className="btn btn-secondary">
              <Icon name={a.icon} size={16} stroke={1.75} />
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Fee defaulters */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-rule">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[16px] font-semibold text-ink">Fee defaulters</h2>
            {!loading && recent.length > 0 && (
              <span className="text-[13px] text-ink-3">
                {recent.length} ranked by highest pending dues
              </span>
            )}
          </div>
          <Link href="/fees/defaulters" className="text-[13px] font-medium text-accent hover:underline">
            View all
          </Link>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : recent.length === 0 ? (
          <EmptyState message="No defaulters this month." />
        ) : (
          <motion.div
            className="overflow-x-auto"
            initial={reduced ? false : { opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
            animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <table className="ledger min-w-[820px]">
              <thead>
                <tr>
                  <th className="w-14">Rank</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Period</th>
                  <th className="text-right">Total due</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, idx) => (
                  <tr key={r.id} className="row-flag">
                    <td>
                      {idx < 3
                        ? <Badge value="default" label={ordinal(idx + 1)} />
                        : <span className="num text-[13px] text-ink-3">{idx + 1}</span>}
                    </td>
                    <td>
                      <Link href={`/students/${r.student}`} className="font-medium text-ink hover:text-accent block leading-tight">
                        {r.student_name ?? r.student}
                      </Link>
                      <span className="num text-[12px] text-ink-3">#{r.admission_no}</span>
                    </td>
                    <td>{r.current_class}</td>
                    <td className="text-[13px] text-ink-2">{r.month_name ?? r.month} {r.year}</td>
                    <td className="num text-right">{rs(r.total_amount)}</td>
                    <td className="num text-right text-ok">{rs(r.amount_paid)}</td>
                    <td className="num text-right font-semibold text-danger">{rs(r.balance)}</td>
                    <td><Badge value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </div>
    </div>
  )
}
