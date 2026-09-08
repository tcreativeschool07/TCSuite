'use client'

// Fee dashboard. All data loading, the lazy per-class detail fetch +
// cache, bulk-generate flow, and both PDF downloads are verbatim from
// pages/fees/FeeDashboard.jsx. The collection ring and distribution bars keep
// their hand-rolled SVG/div implementations, recolored with tokens.
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  getClassRoomsWithFeeStats,
  bulkGenerateFeeRecords,
  getFeeSummary,
  downloadClassCollectionXlsx,
  downloadBulkInvoicesPdf,
  getClassStudentsFee,
} from '@/src/api/feesApi'
import Modal from '@/src/components/Modal'
import NewReceiptModal from './NewReceiptModal'
import StatCard from '@/src/components/StatCard'
import Badge from '@/src/components/Badge'
import useYears from '@/src/hooks/useYears'
import { Icon, Spinner } from '@/src/components/icons'
import { KpiGridSkeleton, TableSkeleton, EmptyState, Skeleton } from '@/src/components/Skeleton'

const MONTHS = [
  { v: 1,  l: 'January'  }, { v: 2,  l: 'February' }, { v: 3,  l: 'March'     },
  { v: 4,  l: 'April'    }, { v: 5,  l: 'May'       }, { v: 6,  l: 'June'      },
  { v: 7,  l: 'July'     }, { v: 8,  l: 'August'    }, { v: 9,  l: 'September' },
  { v: 10, l: 'October'  }, { v: 11, l: 'November'  }, { v: 12, l: 'December'  },
]
const NOW = new Date()
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const rs = (v) => `Rs ${Number(v).toLocaleString()}`
const ALL_KEY = '__all__'

export default function FeeDashboard() {
  const yearOptions = useYears()
  const [month, setMonth]     = useState(String(NOW.getMonth() + 1))
  const [year, setYear]       = useState(String(NOW.getFullYear()))
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)

  // Bulk generation is fire-and-forget: the dialog only confirms, then closes
  // immediately so the rest of the page stays usable and other classes can be
  // queued while earlier ones are still being written.
  const [bulkTarget, setBulkTarget] = useState(null)  // { kind: 'class'|'all', className? }
  // One due date for the whole run, shared by every class: the deadline is a
  // school-wide decision, not a per-class one. It is stamped on the records at
  // generation and printed on the receipts. Defaults to the 10th of the
  // selected period and follows the period until the user overrides it.
  const [dueDate, setDueDate] = useState('')
  const [receiptModal, setReceiptModal] = useState(false)
  const [generating, setGenerating] = useState({})    // { [class name | ALL_KEY]: true }
  const [genResults, setGenResults] = useState([])    // newest-first run log

  const [pdfLoading, setPdfLoading] = useState(null)
  const [bulkPdfLoading, setBulkPdfLoading] = useState(null)

  const [expanded, setExpanded]           = useState({})
  const [classDetail, setClassDetail]     = useState({})
  const [detailLoading, setDetailLoading] = useState({})

  const periodParams = useCallback(() => {
    const params = {}
    if (month) params.month = month
    if (year)  params.year  = year
    return params
  }, [month, year])

  // Quiet refetch of the figures only: no skeleton flash, and it leaves whatever
  // the user has expanded alone. Used after a background generation lands.
  const refreshStats = useCallback(async ({ notify = false } = {}) => {
    try {
      const [classRes, sumRes] = await Promise.all([
        getClassRoomsWithFeeStats(periodParams()),
        getFeeSummary(month && year ? { month, year } : {}),
      ])
      setClasses(classRes.data)
      setSummary(sumRes.data)
    } catch {
      // Keep the previous figures on screen rather than blanking the page.
      if (notify) toast.error('Failed to load dashboard')
    }
  }, [month, year, periodParams])

  const load = useCallback(() => {
    setLoading(true)
    setExpanded({})
    setClassDetail({})
    refreshStats({ notify: true }).finally(() => setLoading(false))
  }, [refreshStats])

  useEffect(() => { load() }, [load])

  // The due date tracks the selected period — the 10th of that month, the usual
  // deadline — and the user overrides it from the period panel when they want a
  // different one. Changing the period resets it to that month's default.
  useEffect(() => {
    setDueDate(month && year ? `${year}-${String(month).padStart(2, '0')}-10` : '')
  }, [month, year])

  // Background callbacks fire long after the render that scheduled them, so they
  // read the current classes/expansion through refs instead of a stale closure.
  const classesRef  = useRef(classes)
  const expandedRef = useRef(expanded)
  useEffect(() => { classesRef.current = classes },   [classes])
  useEffect(() => { expandedRef.current = expanded }, [expanded])

  const fetchClassDetail = useCallback(async (classObj) => {
    const key = classObj.id
    setDetailLoading(prev => ({ ...prev, [key]: true }))
    try {
      const { data } = await getClassStudentsFee(classObj.id, periodParams())
      setClassDetail(prev => ({ ...prev, [key]: data }))
    } catch {
      toast.error(`Failed to load students for ${classObj.name}`)
    } finally {
      setDetailLoading(prev => ({ ...prev, [key]: false }))
    }
  }, [periodParams])

  const toggleClassDetail = async (classObj) => {
    const key = classObj.id
    if (expanded[key]) {
      setExpanded(prev => ({ ...prev, [key]: false }))
      return
    }
    setExpanded(prev => ({ ...prev, [key]: true }))
    if (classDetail[key]) return
    await fetchClassDetail(classObj)
  }

  // After records land, drop the cached student tables we just invalidated and
  // refetch only the ones still open. `classNames === null` means every class.
  const refreshOpenClassDetails = useCallback((classNames) => {
    const affected = classesRef.current.filter(
      c => classNames === null || classNames.includes(c.name)
    )
    setClassDetail(prev => {
      const next = { ...prev }
      affected.forEach(c => { delete next[c.id] })
      return next
    })
    affected
      .filter(c => expandedRef.current[c.id])
      .forEach(c => { fetchClassDetail(c) })
  }, [fetchClassDetail])

  const anyGenerating = Object.keys(generating).length > 0

  // State updates are async, so a fast double-click would pass the `generating`
  // check twice before the first render lands. The ref closes that window.
  const inFlightRef = useRef({})

  // Kicks the request off and returns: the dialog closes, a toast tracks
  // progress, and the user is free to open another class and queue that too.
  const startGenerate = (target) => {
    const key = target.kind === 'all' ? ALL_KEY : target.className
    if (inFlightRef.current[key]) return
    if (!month || !year) { toast.error('Select a month and year first'); return }
    inFlightRef.current[key] = true

    const label = target.kind === 'all' ? 'all classes' : target.className
    const payload = {
      month: Number(month),
      year:  Number(year),
      ...(target.kind === 'all' ? { all_classes: true } : { current_class: target.className }),
      ...(dueDate ? { due_date: dueDate } : {}),
    }

    setBulkTarget(null)
    setGenerating(prev => ({ ...prev, [key]: true }))
    const toastId = toast.loading(`Generating fee records for ${label}…`)

    bulkGenerateFeeRecords(payload)
      .then(({ data }) => {
        const noFee = data.errors?.length ?? 0
        toast.success(
          `${label}: ${data.created} created, ${data.skipped} already existed` +
          (noFee ? `, ${noFee} without a fee` : ''),
          { id: toastId, duration: 6000 }
        )
        setGenResults(prev => [
          { key, label, at: Date.now(), ...data },
          ...prev.filter(r => r.key !== key),
        ].slice(0, 6))
        refreshStats()
        refreshOpenClassDetails(target.kind === 'all' ? null : [target.className])
      })
      .catch(err => {
        const raw = err.response?.data
        const msg = raw?.detail
          || raw?.non_field_errors?.[0]
          || (raw && typeof raw === 'object' ? Object.values(raw).flat()[0] : null)
          || 'Bulk generation failed'
        toast.error(`${label}: ${Array.isArray(msg) ? msg[0] : msg}`, { id: toastId, duration: 8000 })
      })
      .finally(() => {
        delete inFlightRef.current[key]
        setGenerating(prev => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      })
  }

  const handleDownloadClassSheet = async (className) => {
    if (!month || !year) { toast.error('Select month and year first'); return }
    setPdfLoading(className)
    try {
      const { data } = await downloadClassCollectionXlsx({ current_class: className, month, year })
      const url = URL.createObjectURL(new Blob([data], { type: XLSX_MIME }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Fee_Collection_${className}_${month}_${year}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Collection sheet downloaded')
    } catch {
      toast.error('Failed to generate collection sheet')
    } finally {
      setPdfLoading(null)
    }
  }

  const handleDownloadBulkInvoices = async (className) => {
    if (!month || !year) { toast.error('Select month and year first'); return }
    setBulkPdfLoading(className)
    try {
      const { data } = await downloadBulkInvoicesPdf({
        current_class: className, month, year,
        ...(dueDate ? { due_date: dueDate } : {}),
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Receipts_${className}_${month}_${year}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Receipts downloaded')
    } catch {
      toast.error('Failed to generate receipts. Make sure fee records exist.')
    } finally {
      setBulkPdfLoading(null)
    }
  }

  const monthLabel = MONTHS.find(m => m.v === Number(month))?.l ?? ''
  const dueDateLabel = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined,
        { day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Fee dashboard</h1>
          <p className="text-[13px] text-ink-3 mt-1">Class-wise fee overview — open a class to see individual students</p>
        </div>
        <div className="flex gap-2">
          <Link href="/fees/defaulters" className="btn btn-secondary">
            <Icon name="report" size={16} stroke={1.75} />
            Fee defaulters
          </Link>
          <Link href="/fees/records" className="btn btn-secondary">View all records</Link>
          <Link href="/fees/structures" className="btn btn-secondary">Fee structures</Link>
        </div>
      </div>

      {/* Period selector */}
      <div className="panel p-4">
        <p className="label mb-3">Select period</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label" htmlFor="fd-month">Month</label>
            <select id="fd-month" className="input w-44" value={month} onChange={e => setMonth(e.target.value)}>
              <option value="">All months</option>
              {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fd-year">Year</label>
            <select id="fd-year" className="input w-32" value={year} onChange={e => setYear(e.target.value)}>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Overall summary stats — skeleton only before the first data arrives;
          period changes keep the previous stats visible while refreshing */}
      {loading && !summary ? (
        <KpiGridSkeleton count={5} />
      ) : summary && (() => {
        const collRate = summary.total_due > 0
          ? Math.round((summary.total_collected / summary.total_due) * 100) : 0
        const totalStudents = classes.reduce((s, c) => s + c.student_count, 0)
        const avgFeePerStudent = summary.total_records > 0
          ? Math.round(summary.total_due / summary.total_records) : 0

        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <StatCard
                title="Total records"
                value={<span className="num">{summary.total_records}</span>}
                sub={month && year ? `${monthLabel} ${year}` : 'All time'}
                color="blue"
                icon={<Icon name="report" size={18} />}
              />
              <StatCard
                title="Total due"
                value={rs(summary.total_due || 0)}
                sub="Total amount billed"
                color="teal"
                icon={<Icon name="card" size={18} />}
              />
              <StatCard
                title={month ? `${monthLabel} fees` : 'Fees, no arrears'}
                value={rs(summary.total_current_fee || 0)}
                sub={
                  summary.total_previous_balance
                    ? `Excludes ${rs(summary.total_previous_balance)} arrears`
                    : 'Excludes arrears'
                }
                color="yellow"
                icon={<Icon name="tag" size={18} />}
              />
              <StatCard
                title="Collected"
                value={rs(summary.total_collected || 0)}
                sub={`${summary.paid_count ?? 0} fully paid`}
                color="green"
                icon={<Icon name="calculator" size={18} />}
              />
              <StatCard
                title="Outstanding"
                value={rs(summary.total_balance || 0)}
                sub={`${summary.unpaid_count ?? 0} unpaid, ${summary.partial_count ?? 0} partial`}
                color="red"
                icon={<Icon name="chart" size={18} />}
                href="/fees/defaulters"
              />
            </div>

            {/* Analytics row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Collection rate */}
              <div className="panel p-5">
                <h3 className="text-[13px] font-medium text-ink-2 mb-3">Collection rate</h3>
                <div className="flex items-center gap-4">
                  <div className="relative w-20 h-20 shrink-0">
                    <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke="var(--rule)" strokeWidth="3" />
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke={collRate >= 80 ? 'var(--ok)' : collRate >= 50 ? 'var(--warn)' : 'var(--danger)'}
                        strokeWidth="3"
                        strokeDasharray={`${collRate}, 100`}
                        strokeLinecap="round" />
                    </svg>
                    <span className="num absolute inset-0 flex items-center justify-center text-[17px] font-semibold text-ink">
                      {collRate}%
                    </span>
                  </div>
                  <div className="text-[13px] space-y-1 text-ink-2">
                    <p>Collected <strong className="num text-ok">{rs(summary.total_collected || 0)}</strong></p>
                    <p>out of <strong className="num text-ink">{rs(summary.total_due || 0)}</strong></p>
                  </div>
                </div>
              </div>

              {/* Status distribution */}
              <div className="panel p-5">
                <h3 className="text-[13px] font-medium text-ink-2 mb-3">Status distribution</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Paid', count: summary.paid_count || 0, bar: 'bg-ok', text: 'text-ok' },
                    { label: 'Partial', count: summary.partial_count || 0, bar: 'bg-warn', text: 'text-warn' },
                    { label: 'Unpaid', count: summary.unpaid_count || 0, bar: 'bg-danger', text: 'text-danger' },
                  ].map(item => {
                    const pct = summary.total_records > 0 ? Math.round((item.count / summary.total_records) * 100) : 0
                    return (
                      <div key={item.label}>
                        <div className="flex justify-between text-[12.5px] mb-1">
                          <span className={`font-medium ${item.text}`}>{item.label}</span>
                          <span className="num text-ink-2">{item.count} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-rule rounded-full h-1.5">
                          <div className={`${item.bar} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Quick insights */}
              <div className="panel p-5">
                <h3 className="text-[13px] font-medium text-ink-2 mb-3">Quick insights</h3>
                <div className="space-y-2.5 text-[13.5px]">
                  <div className="flex justify-between">
                    <span className="text-ink-2">Total students</span>
                    <strong className="num text-ink">{totalStudents}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-2">Records generated</span>
                    <strong className="num text-ink">{summary.total_records} / {totalStudents}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-2">Avg fee per student</span>
                    <strong className="num text-ink">Rs {avgFeePerStudent.toLocaleString()}</strong>
                  </div>
                  <Link href="/fees/defaulters" className="group flex justify-between">
                    <span className="text-ink-2 group-hover:text-accent">Defaulters</span>
                    <strong className="num text-danger">{(summary.unpaid_count || 0) + (summary.partial_count || 0)}</strong>
                  </Link>
                  <Link href="/fees/defaulters" className="btn btn-secondary btn-sm w-full mt-2">
                    View fee defaulters
                  </Link>
                  <Link href="/balance-sheet" className="btn btn-secondary btn-sm w-full">
                    View full balance sheet
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
      })()}

      {/* Class-wise accordion */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-ink">
            Class-wise overview{month && year ? ` — ${monthLabel} ${year}` : ''}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <span className="num text-[13px] text-ink-3 pb-2">{classes.length} classes</span>
            {/* One due date for the whole school: it is stamped on records as
                they are generated and printed on every class's receipts. */}
            <div>
              <label className="label mb-1 text-[12px]" htmlFor="fd-due">
                Due date · all classes
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="fd-due"
                  type="date"
                  className="input w-40 h-[30px] px-2 text-[13px]"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  title="Printed on every receipt and stamped on newly generated records"
                />
                {dueDate && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm px-2"
                    onClick={() => setDueDate('')}
                    title="Leave receipts without a due date"
                  >
                    <Icon name="close" size={15} stroke={1.75} />
                  </button>
                )}
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm mb-0.5"
              onClick={() => setReceiptModal(true)}
            >
              <Icon name="plus" size={15} stroke={1.75} />
              New receipt
            </button>
            {month && year && classes.length > 0 && (
              <button
                className="btn btn-primary btn-sm mb-0.5"
                onClick={() => setBulkTarget({ kind: 'all' })}
                disabled={!!generating[ALL_KEY]}
              >
                {generating[ALL_KEY]
                  ? (<><Spinner /> Generating all classes…</>)
                  : 'Generate records for all classes'}
              </button>
            )}
          </div>
        </div>

        {/* In-flight banner — generation keeps running while the page is used */}
        {anyGenerating && (
          <div className="panel p-3 flex items-center gap-2.5 text-[13px]" role="status" aria-live="polite">
            <Spinner />
            <span className="text-ink-2">
              Generating records for{' '}
              <strong className="text-ink">
                {Object.keys(generating).map(k => (k === ALL_KEY ? 'all classes' : k)).join(', ')}
              </strong>
              . You can keep using the page — results appear here when each run finishes.
            </span>
          </div>
        )}

        {/* Completed runs */}
        {genResults.length > 0 && (
          <div className="panel p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-ink-2">Recent generation results</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setGenResults([])}>Clear</button>
            </div>
            {genResults.map(r => (
              <div key={r.key + r.at} className="text-[13px] border-t border-rule pt-2 first:border-0 first:pt-0">
                <p className="text-ink">
                  <strong>{r.label}</strong>{' — '}
                  <span className="num text-ok">{r.created}</span> created,{' '}
                  <span className="num text-ink-2">{r.skipped}</span> already existed
                  {r.errors?.length > 0 && (<>, <span className="num text-warn">{r.errors.length}</span> without a fee</>)}
                  <span className="text-ink-3"> (of {r.total_students} students)</span>
                </p>
                {r.errors?.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-warn cursor-pointer text-[12.5px]">
                      Show {r.errors.length} student{r.errors.length === 1 ? '' : 's'} skipped for a missing fee
                    </summary>
                    <ul className="text-[12.5px] text-warn mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                      {r.errors.map((e, i) => <li key={i}>- {e}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        {loading && classes.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="panel p-4"><Skeleton className="h-10" /></div>
            ))}
          </div>
        ) : classes.length === 0 ? (
          <div className="panel">
            <EmptyState
              message="No classes found."
              action={<Link href="/classes" className="btn btn-secondary">Add or sync classes</Link>}
            />
          </div>
        ) : (
          <>
            {classes.map(c => {
              const fs = c.fee_stats || {}
              const hasStats = month && year && fs.records_count !== undefined
              const collectionRate = hasStats && fs.total_due > 0
                ? Math.round((fs.total_collected / fs.total_due) * 100) : null
              const isExpanded = expanded[c.id]
              const detail = classDetail[c.id]
              const isDetailLoading = detailLoading[c.id]

              return (
                <div key={c.id} className="panel panel-interactive overflow-hidden">
                  {/* Class summary row */}
                  <button
                    type="button"
                    className="w-full text-left px-5 py-3.5 hover:bg-surface-sunken transition-colors duration-120"
                    onClick={() => toggleClassDetail(c)}
                    aria-expanded={!!isExpanded}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                      <div className="lg:w-44 shrink-0">
                        <p className="font-semibold text-ink">{c.name}</p>
                        {generating[c.name] || generating[ALL_KEY] ? (
                          <p className="text-[13px] text-accent flex items-center gap-1.5">
                            <Spinner /> Generating…
                          </p>
                        ) : (
                          <p className="num text-[13px] text-ink-3">{c.student_count} students</p>
                        )}
                      </div>

                      {hasStats ? (
                        <div className="flex flex-wrap gap-x-5 gap-y-1 flex-1 text-[13px]">
                          <span className="text-ink-2">
                            Records{' '}
                            <strong className={`num ${fs.records_count < c.student_count ? 'text-warn' : 'text-ink'}`}>
                              {fs.records_count}{fs.records_count < c.student_count && `/${c.student_count}`}
                            </strong>
                          </span>
                          <span className="text-ink-2">
                            Due <strong className="num text-ink">{rs(fs.total_due)}</strong>
                          </span>
                          <span className="text-ink-2">
                            Collected <strong className="num text-ok">{rs(fs.total_collected)}</strong>
                            {collectionRate !== null && <span className="num text-[12px] text-ink-3 ml-1">({collectionRate}%)</span>}
                          </span>
                          {fs.total_balance > 0 && (
                            <span className="text-ink-2">
                              Balance <strong className="num text-danger">{rs(fs.total_balance)}</strong>
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Badge value="paid" label={String(fs.paid_count)} />
                            {fs.unpaid_count > 0 && <Badge value="unpaid" label={String(fs.unpaid_count)} />}
                            {fs.partial_count > 0 && <Badge value="partial" label={String(fs.partial_count)} />}
                          </span>
                        </div>
                      ) : (
                        <div className="flex-1 text-[13px] text-ink-3">Select a month and year to see fee stats.</div>
                      )}

                      <Icon
                        name="chevronDown"
                        size={18}
                        className={`text-ink-3 transition-transform duration-120 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {/* Expanded: actions + student table */}
                  {isExpanded && (
                    <div className="border-t border-rule">
                      {/* Action bar */}
                      <div className="px-5 py-3 bg-surface-sunken flex flex-wrap gap-2 items-center border-b border-rule">
                        {month && year && (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={(e) => { e.stopPropagation(); setBulkTarget({ kind: 'class', className: c.name }) }}
                              disabled={!!generating[c.name] || !!generating[ALL_KEY]}
                            >
                              {generating[c.name] || generating[ALL_KEY]
                                ? (<><Spinner /> Generating…</>)
                                : 'Generate fee records'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={(e) => { e.stopPropagation(); handleDownloadClassSheet(c.name) }}
                              disabled={pdfLoading === c.name}
                            >
                              {pdfLoading === c.name ? (<><Spinner /> Downloading…</>) : 'Collection sheet (Excel)'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={(e) => { e.stopPropagation(); handleDownloadBulkInvoices(c.name) }}
                              disabled={bulkPdfLoading === c.name}
                            >
                              {bulkPdfLoading === c.name ? (<><Spinner /> Downloading…</>) : 'Print receipts (PDF)'}
                            </button>
                          </>
                        )}
                        <Link
                          href={`/fees/records?current_class=${encodeURIComponent(c.name)}${month ? `&month=${month}` : ''}${year ? `&year=${year}` : ''}`}
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View fee records
                        </Link>
                      </div>

                      {/* Student-level fee table */}
                      {isDetailLoading ? (
                        <TableSkeleton rows={5} cols={8} />
                      ) : detail ? (
                        <>
                          {/* Class summary strip */}
                          <div className="px-5 py-2 border-b border-rule text-[12.5px] flex flex-wrap gap-x-5 gap-y-1">
                            <span className="text-ink-2">
                              <strong className="num text-ink">{detail.total_students}</strong> students
                            </span>
                            <span className="text-ink-2">
                              <strong className="num text-ink">{detail.records_generated}</strong> with records
                            </span>
                            {detail.without_records > 0 && (
                              <span className="text-warn">
                                <strong className="num">{detail.without_records}</strong> without records
                              </span>
                            )}
                            <span className="text-ink-2">
                              Due <strong className="num text-ink">{rs(detail.summary.total_due)}</strong>
                            </span>
                            <span className="text-ok">
                              Collected <strong className="num">{rs(detail.summary.total_collected)}</strong>
                            </span>
                            {detail.summary.total_balance > 0 && (
                              <span className="text-danger">
                                Balance <strong className="num">{rs(detail.summary.total_balance)}</strong>
                              </span>
                            )}
                          </div>

                          {detail.students.length === 0 ? (
                            <EmptyState message="No students in this class." />
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="ledger min-w-[1000px]">
                                <thead>
                                  <tr>
                                    <th>Admission no.</th>
                                    <th>Student name</th>
                                    <th>Guardian</th>
                                    <th>Contact</th>
                                    <th className="text-right">Prev bal</th>
                                    <th className="text-right">Fee</th>
                                    <th className="text-right">Misc.</th>
                                    <th className="text-right">Total</th>
                                    <th className="text-right">Paid</th>
                                    <th className="text-right">Balance</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.students.map(s => {
                                    const r = s.fee_record
                                    const isDefaulter = r && (r.status === 'unpaid' || r.status === 'partial')
                                    const isAdvance = r && (r.status === 'advance' || r.is_advance)
                                    return (
                                      <tr key={s.id} className={isDefaulter ? 'row-flag' : isAdvance ? 'row-info' : ''}>
                                        <td className="num text-accent text-[13px]">
                                          <Link href={`/students/${s.id}`} className="hover:underline">{s.admission_no}</Link>
                                        </td>
                                        <td className="font-medium">
                                          <Link href={`/students/${s.id}`} className="hover:text-accent">{s.student_name}</Link>
                                        </td>
                                        <td className="text-ink-2">{s.f_g_name}</td>
                                        <td className="num text-ink-2">{s.f_g_contact}</td>
                                        {r ? (
                                          <>
                                            <td className="num text-right text-[13px]">
                                              {r.previous_balance > 0
                                                ? <span className="text-warn">{rs(r.previous_balance)}</span>
                                                : <span className="text-ink-3">0</span>}
                                            </td>
                                            <td className="num text-right text-[13px]">{rs(r.current_fee)}</td>
                                            <td className="num text-right text-[13px]">
                                              {Number(r.misc_charges) > 0
                                                ? <span className="text-info">{rs(r.misc_charges)}</span>
                                                : <span className="text-ink-3">0</span>}
                                            </td>
                                            <td className="num text-right text-[13px] font-medium">{rs(r.total_amount)}</td>
                                            <td className="num text-right text-[13px] text-ok">{rs(r.amount_paid)}</td>
                                            <td className="num text-right text-[13px]">
                                              {r.balance > 0
                                                ? <span className="text-danger font-semibold">{rs(r.balance)}</span>
                                                : <span className="text-ink-3">0</span>}
                                            </td>
                                            <td>
                                              <span className="inline-flex items-center gap-1.5">
                                                <Badge value={r.status} />
                                                {r.is_late && <Badge value="late" label="Late" title="Paid after the month ended" />}
                                              </span>
                                            </td>
                                          </>
                                        ) : (
                                          <td colSpan={7} className="text-center text-[13px] text-warn italic">
                                            No fee record for this period
                                          </td>
                                        )}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                                {/* Totals footer */}
                                {detail.students.some(s => s.fee_record) && (
                                  <tfoot>
                                    <tr>
                                      <td colSpan={4}>Totals</td>
                                      <td className="num text-right">
                                        Rs {detail.students.reduce((s, st) => s + (st.fee_record?.previous_balance || 0), 0).toLocaleString()}
                                      </td>
                                      <td className="num text-right">
                                        Rs {detail.students.reduce((s, st) => s + (st.fee_record?.current_fee || 0), 0).toLocaleString()}
                                      </td>
                                      <td className="num text-right text-info">
                                        Rs {detail.students.reduce((s, st) => s + Number(st.fee_record?.misc_charges || 0), 0).toLocaleString()}
                                      </td>
                                      <td className="num text-right">{rs(detail.summary.total_due)}</td>
                                      <td className="num text-right text-ok">{rs(detail.summary.total_collected)}</td>
                                      <td className="num text-right text-danger">{rs(detail.summary.total_balance)}</td>
                                      <td></td>
                                    </tr>
                                  </tfoot>
                                )}
                              </table>
                            </div>
                          )}
                        </>
                      ) : (
                        <EmptyState message="Open a class to load student details." />
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Grand totals */}
            {month && year && classes.length > 0 && (
              <div className="panel p-4">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                  <span className="font-semibold text-ink">
                    Grand totals ({classes.reduce((s, c) => s + c.student_count, 0)} students)
                  </span>
                  <span className="text-ink-2">
                    Records <strong className="num text-ink">{classes.reduce((s, c) => s + (c.fee_stats?.records_count ?? 0), 0)}</strong>
                  </span>
                  <span className="text-ink-2">
                    Due <strong className="num text-ink">Rs {classes.reduce((s, c) => s + (c.fee_stats?.total_due ?? 0), 0).toLocaleString()}</strong>
                  </span>
                  <span className="text-ok">
                    Collected <strong className="num">Rs {classes.reduce((s, c) => s + (c.fee_stats?.total_collected ?? 0), 0).toLocaleString()}</strong>
                  </span>
                  <span className="text-danger">
                    Balance <strong className="num">Rs {classes.reduce((s, c) => s + (c.fee_stats?.total_balance ?? 0), 0).toLocaleString()}</strong>
                  </span>
                  <span className="text-ink-2">
                    Paid <strong className="num text-ink">{classes.reduce((s, c) => s + (c.fee_stats?.paid_count ?? 0), 0)}</strong>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bulk generate confirmation — confirming closes it and the run continues
          in the background, so nothing here waits on the request. */}
      <Modal
        open={!!bulkTarget}
        onClose={() => setBulkTarget(null)}
        title={bulkTarget?.kind === 'all' ? 'Generate records for all classes' : `Bulk generate — ${bulkTarget?.className}`}
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-control bg-surface-sunken p-4 text-[13.5px] space-y-1">
            <p>
              <span className="text-ink-2">Scope:</span>{' '}
              <strong className="text-ink">
                {bulkTarget?.kind === 'all'
                  ? `All ${classes.length} classes — ${classes.reduce((n, c) => n + c.student_count, 0)} students`
                  : bulkTarget?.className}
              </strong>
            </p>
            <p><span className="text-ink-2">Period:</span> <strong className="text-ink">{monthLabel} {year}</strong></p>
            <p>
              <span className="text-ink-2">Due date:</span>{' '}
              <strong className="text-ink">{dueDateLabel || 'None'}</strong>
              <span className="text-ink-3"> · set in Select period, same for every class</span>
            </p>
            <p className="text-[13px] text-ink-3 mt-2">
              This creates fee records for every active student in scope who doesn&apos;t
              already have one for this month/year — students who do are left untouched.
              Each fee is taken from the student&apos;s individual fee override, or the
              class fee structure.
            </p>
            <p className="text-[13px] text-ink-3">
              The run continues in the background, so you can close this and keep working.
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <button className="btn btn-secondary" onClick={() => setBulkTarget(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => startGenerate(bulkTarget)}>
              {bulkTarget?.kind === 'all' ? 'Generate for all classes' : 'Generate fee records'}
            </button>
          </div>
        </div>
      </Modal>

      <NewReceiptModal open={receiptModal} onClose={() => setReceiptModal(false)} />
    </div>
  )
}
