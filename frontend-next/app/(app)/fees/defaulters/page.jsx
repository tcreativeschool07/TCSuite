'use client'

// The full defaulters list behind "View all" on the dashboard. Same rows as the
// dashboard's top-ten (the top-defaulters endpoint, same serializer), but
// unbounded and filterable: every record still owing, largest balance first,
// narrowed by class and by student name.
//
// Filtering is server-side (the endpoint reuses the viewset's own class filter
// and SearchFilter) so the ordering stays true across the whole set rather than
// only within a page. Paging is client-side because the endpoint returns a
// plain list — the filters keep that list small in practice.
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { getTopDefaulters } from '@/src/api/feesApi'
import Badge from '@/src/components/Badge'
import StatCard from '@/src/components/StatCard'
import CountUp from '@/src/components/CountUp'
import useClassOptions from '@/src/hooks/useClassOptions'
import useYears from '@/src/hooks/useYears'
import { Icon } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const rs = (v) => `Rs ${Number(v || 0).toLocaleString()}`
const PAGE_SIZE = 25
// Matches MAX_DEFAULTERS in fees/views.py — hitting it means the list was cut.
const SERVER_CAP = 2000

const MONTHS = [
  { v: '', l: 'All months' },
  { v: '1', l: 'January' },   { v: '2', l: 'February' }, { v: '3', l: 'March' },
  { v: '4', l: 'April' },     { v: '5', l: 'May' },      { v: '6', l: 'June' },
  { v: '7', l: 'July' },      { v: '8', l: 'August' },   { v: '9', l: 'September' },
  { v: '10', l: 'October' },  { v: '11', l: 'November' }, { v: '12', l: 'December' },
]

export default function DefaultersPage() {
  const classOptions = useClassOptions()
  const yearOptions = useYears()

  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch]           = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear]   = useState('')
  const [page, setPage]               = useState(1)

  // Debounced so typing a name doesn't fire a request per keystroke.
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const params = { limit: 0 }          // 0 = the whole list, not the top ten
    if (query)       params.search        = query
    if (filterClass) params.current_class = filterClass
    if (filterMonth) params.month         = filterMonth
    if (filterYear)  params.year          = filterYear
    getTopDefaulters(params)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load defaulters'))
      .finally(() => setLoading(false))
  }, [query, filterClass, filterMonth, filterYear])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filterClass, filterMonth, filterYear])

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.outstanding += Number(r.balance || 0)
      acc.students.add(r.student)
      return acc
    },
    { outstanding: 0, students: new Set() },
  ), [rows])

  const hasFilters = query || filterClass || filterMonth || filterYear
  const clearAll = () => {
    setSearch(''); setFilterClass(''); setFilterMonth(''); setFilterYear(''); setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const from = rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, rows.length)

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Fee defaulters</h1>
          <p className="text-[13px] text-ink-3 mt-1">
            Every record still owing, highest balance first.
          </p>
        </div>
        <Link href="/" className="btn btn-secondary">
          <Icon name="home" size={16} stroke={1.75} />
          Dashboard
        </Link>
      </div>

      {/* Totals for whatever is currently filtered */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Outstanding records"
          value={<CountUp value={rows.length} />}
          sub={hasFilters ? 'Matching these filters' : 'Across all periods'}
          color="red"
          icon={<Icon name="report" size={18} />}
        />
        <StatCard
          title="Students affected"
          value={<CountUp value={totals.students.size} />}
          sub="Distinct students"
          color="yellow"
          icon={<Icon name="students" size={18} />}
        />
        <StatCard
          title="Total outstanding"
          value={<CountUp value={totals.outstanding} format={(v) => rs(v)} />}
          sub="Sum of balances shown"
          color="blue"
          icon={<Icon name="card" size={18} />}
        />
      </div>

      {/* Filters */}
      <div className="panel p-4 flex flex-col sm:flex-row gap-3">
        <input
          className="input flex-1"
          placeholder="Search by student name or admission no.…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search defaulters by student"
        />
        <select
          className="input w-full sm:w-44"
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          aria-label="Filter by class"
        >
          <option value="">All classes</option>
          {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="input w-full sm:w-40"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          aria-label="Filter by month"
        >
          {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
        <select
          className="input w-full sm:w-32"
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          aria-label="Filter by year"
        >
          <option value="">All years</option>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {hasFilters && (
          <button className="btn btn-secondary" onClick={clearAll}>Clear</button>
        )}
      </div>

      {/* List */}
      <div className="panel overflow-hidden">
        {loading && rows.length === 0 ? (
          <TableSkeleton rows={10} cols={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={hasFilters
              ? 'No defaulters match these filters.'
              : 'Nothing outstanding — every fee record is settled.'}
            action={hasFilters
              ? <button className="btn btn-secondary" onClick={clearAll}>Clear filters</button>
              : null}
          />
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity duration-120 ${loading ? 'opacity-60' : ''}`}>
              <table className="ledger min-w-[920px]">
                <thead>
                  <tr>
                    <th className="w-14">#</th>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Period</th>
                    <th>Guardian</th>
                    <th className="text-right">Total due</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, idx) => (
                    <tr key={r.id} className="row-flag">
                      <td className="num text-[13px] text-ink-3">
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td>
                        <Link
                          href={`/students/${r.student}`}
                          className="font-medium text-ink hover:text-accent block leading-tight"
                        >
                          {r.student_name ?? r.student}
                        </Link>
                        <span className="num text-[12px] text-ink-3">#{r.admission_no}</span>
                      </td>
                      <td>{r.current_class}</td>
                      <td className="text-[13px] text-ink-2">
                        {r.month_name ?? r.month} {r.year}
                      </td>
                      <td className="text-[13px] text-ink-2">
                        <span className="block leading-tight">{r.f_g_name}</span>
                        <span className="num text-[12px] text-ink-3">{r.f_g_contact}</span>
                      </td>
                      <td className="num text-right">{rs(r.total_amount)}</td>
                      <td className="num text-right text-ok">{rs(r.amount_paid)}</td>
                      <td className="num text-right font-semibold text-danger">{rs(r.balance)}</td>
                      <td><Badge value={r.status} /></td>
                      <td>
                        <Link
                          href={`/fees/records?student=${r.student}&month=${r.month}&year=${r.year}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Collect
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3">
              <p className="num text-[13px] text-ink-2">
                Showing {from}–{to} of {rows.length}
                {rows.length >= SERVER_CAP && (
                  <span className="text-warn">
                    {' '}· capped at {SERVER_CAP}, narrow the filters to see the rest
                  </span>
                )}
              </p>
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="btn btn-secondary btn-sm"
                  >
                    Previous
                  </button>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                    className="btn btn-secondary btn-sm"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
