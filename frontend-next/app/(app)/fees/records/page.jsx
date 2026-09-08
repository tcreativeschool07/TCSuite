'use client'

// Fee records — the master ledger. All filter/pagination/URL-seeding
// state, the receipt lookup normalization, and all six modal flows (create,
// payment, edit, delete, advance payment) are verbatim from
// pages/fees/FeeRecords.jsx. useSearchParams is wrapped in Suspense as Next
// requires.
import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  getFeeRecords, createFeeRecord, recordPayment, getArrearsBreakdown,
  editFeeRecord, deleteFeeRecord,
  downloadStudentInvoicePdf, downloadClassCollectionXlsx,
  advancePayment, lookupReceipt,
} from '@/src/api/feesApi'
import { getStudents } from '@/src/api/studentsApi'
import Badge from '@/src/components/Badge'
import Modal from '@/src/components/Modal'
import useYears from '@/src/hooks/useYears'
import useClassOptions from '@/src/hooks/useClassOptions'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const MONTHS = [
  { v: 1,  l: 'January'  }, { v: 2,  l: 'February' }, { v: 3,  l: 'March'     },
  { v: 4,  l: 'April'    }, { v: 5,  l: 'May'       }, { v: 6,  l: 'June'      },
  { v: 7,  l: 'July'     }, { v: 8,  l: 'August'    }, { v: 9,  l: 'September' },
  { v: 10, l: 'October'  }, { v: 11, l: 'November'  }, { v: 12, l: 'December'  },
]
const STATUSES = ['unpaid', 'partial', 'paid', 'advance', 'waived']
const NOW = new Date()
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const rs = (v) => `Rs ${Number(v).toLocaleString()}`

// One payment can settle this month's fee and charges plus any earlier month's,
// each in its own box. Form keys: 'fee' / 'misc' (this month), 'legacy', and
// per earlier record `p<id>_fee` / `p<id>_misc`.
const EMPTY_PAY = {}
const num = (v) => Number(v) || 0
const outstanding = (billed, paid) => Math.max(0, num(billed) - num(paid))

const EMPTY_CREATE = {
  student: '', month: NOW.getMonth() + 1, year: NOW.getFullYear(),
  amount_paid: 0, due_date: '',
  previous_balance: '', current_fee: '',
}

function FeeRecordsInner() {
  const yearOptions = useYears()
  const sp = useSearchParams()

  const [data, setData]       = useState([])
  const [count, setCount]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const PAGE_SIZE = 25

  const classOptions = useClassOptions()

  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState(sp.get('status') || '')
  const [filterMonth, setFilterMonth]   = useState(sp.get('month') || String(NOW.getMonth() + 1))
  const [filterYear, setFilterYear]     = useState(sp.get('year') || String(NOW.getFullYear()))
  const [filterClass, setFilterClass]   = useState(sp.get('current_class') || '')
  const [filterStudent, setFilterStudent] = useState(sp.get('student') || '')

  const [createModal, setCreateModal]   = useState(false)
  const [createForm, setCreateForm]     = useState(EMPTY_CREATE)
  const [creating, setCreating]         = useState(false)
  const [studentOptions, setStudentOptions] = useState([])
  const [studentSearch, setStudentSearch]   = useState('')

  const [payModal, setPayModal]   = useState(null)
  const [payForm, setPayForm]     = useState(EMPTY_PAY)
  const [paying, setPaying]       = useState(false)
  // Where the arrears come from: earlier months still owing + legacy balance.
  const [arrears, setArrears]     = useState(null)

  const [pdfLoading, setPdfLoading] = useState(null)

  const [editModal, setEditModal]         = useState(null)
  const [editForm, setEditForm]           = useState({})
  const [editing, setEditing]             = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]           = useState(false)

  const [advModal, setAdvModal]                   = useState(false)
  const [advStudentSearch, setAdvStudentSearch]   = useState('')
  const [advStudentOptions, setAdvStudentOptions] = useState([])
  const [advSelected, setAdvSelected]             = useState([])
  const [advMonths, setAdvMonths]                 = useState([])
  const [advYear, setAdvYear]                     = useState(String(NOW.getFullYear()))
  const [advAmount, setAdvAmount]                 = useState('')
  const [advRemarks, setAdvRemarks]               = useState('')
  const [advLoading, setAdvLoading]               = useState(false)

  const [receiptQuery, setReceiptQuery]         = useState('')
  const [receiptResult, setReceiptResult]       = useState(null)
  const [receiptError, setReceiptError]         = useState('')
  const [receiptSearching, setReceiptSearching] = useState(false)

  const handleReceiptLookup = async (e) => {
    e.preventDefault()
    const q = receiptQuery.trim().replace(/-/g, '')
    if (!q) return
    setReceiptSearching(true)
    setReceiptResult(null)
    setReceiptError('')
    try {
      const { data: rec } = await lookupReceipt(q)
      setReceiptResult(rec)
    } catch (err) {
      setReceiptError(err.response?.data?.error || 'Receipt not found')
    } finally {
      setReceiptSearching(false)
    }
  }

  const buildParams = useCallback(() => {
    const p = { page, page_size: PAGE_SIZE }
    if (search)        p.search        = search
    if (filterStatus)  p.status        = filterStatus
    if (filterMonth)   p.month         = filterMonth
    if (filterYear)    p.year          = filterYear
    if (filterClass)   p.current_class = filterClass
    if (filterStudent && String(filterStudent).match(/^\d+$/)) p.student = filterStudent
    return p
  }, [page, search, filterStatus, filterMonth, filterYear, filterClass, filterStudent])

  const load = useCallback(() => {
    setLoading(true)
    getFeeRecords(buildParams())
      .then(({ data: res }) => {
        setData(res.results ?? res)
        setCount(res.count ?? (res.results ?? res).length)
      })
      .catch(() => toast.error('Failed to load records'))
      .finally(() => setLoading(false))
  }, [buildParams])

  useEffect(() => { load() }, [load])

  // Type-ahead searches: 250ms debounce so fast typing sends one request, not
  // one per keystroke; the cleanup also discards out-of-date lookups.
  useEffect(() => {
    if (studentSearch.length < 2) { setStudentOptions([]); return }
    const t = setTimeout(() => {
      getStudents({ search: studentSearch, page_size: 10 })
        .then(({ data: res }) => setStudentOptions(res.results ?? res))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [studentSearch])

  useEffect(() => {
    if (advStudentSearch.length < 2) { setAdvStudentOptions([]); return }
    const t = setTimeout(() => {
      getStudents({ search: advStudentSearch, page_size: 15 })
        .then(({ data: res }) => setAdvStudentOptions(res.results ?? res))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [advStudentSearch])

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      const payload = { ...createForm }
      if (!payload.previous_balance) delete payload.previous_balance
      if (!payload.current_fee)      delete payload.current_fee
      if (!payload.due_date)         delete payload.due_date
      await createFeeRecord(payload)
      toast.success('Fee record created')
      setCreateModal(false)
      setCreateForm(EMPTY_CREATE)
      setStudentSearch('')
      load()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.non_field_errors?.[0] || d?.detail
        || (typeof d === 'object' ? Object.values(d).flat()[0] : null) || 'Failed'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setCreating(false)
    }
  }

  const openPayModal = (r) => {
    setPayModal(r); setPayForm(EMPTY_PAY); setArrears(null)
    getArrearsBreakdown(r.id)
      .then(({ data }) => setArrears(data))
      .catch(() => setArrears({ legacy: 0, periods: [], total: 0, routable: false }))
  }

  // Every line in the dialog with its own fee/charges boxes and caps, oldest
  // first: legacy balance, each earlier month still owing, then this month.
  const payLines = (record) => {
    if (!record) return []
    const lines = []
    if (arrears?.legacy > 0) lines.push({
      key: 'legacy', label: 'Balance before records', sub: 'Arrears carried in at enrolment', legacy: true,
      fee:  { field: 'legacy', max: arrears.legacy, billed: arrears.legacy },
      misc: { field: null, max: 0, billed: 0 },
    })
    if (arrears?.routable) arrears.periods.forEach(p => lines.push({
      key: `p${p.id}`, id: p.id, label: `${p.month_name} ${p.year}`,
      sub: p.is_late ? 'Earlier month · partly paid late' : 'Earlier month',
      fee:  { field: `p${p.id}_fee`,  max: p.fee_outstanding,  billed: p.fee_outstanding },
      misc: { field: `p${p.id}_misc`, max: p.misc_outstanding, billed: p.misc_outstanding },
    }))
    lines.push({
      key: 'this', current: true, label: `${record.month_name} ${record.year}`, sub: 'This month',
      fee:  { field: 'fee',  max: outstanding(record.current_fee, record.paid_current_fee),   billed: num(record.current_fee) },
      misc: { field: 'misc', max: outstanding(record.misc_charges, record.paid_misc_charges), billed: num(record.misc_charges) },
    })
    return lines
  }

  const payTotal = payLines(payModal).reduce(
    (sum, l) => sum + num(payForm[l.fee.field]) + (l.misc.field ? num(payForm[l.misc.field]) : 0), 0)

  // This month's boxes go to the record itself; every earlier month's go to
  // that month's record (tagged late) via arrears_allocations.
  const handlePayment = async (e) => {
    e.preventDefault()
    if (payTotal <= 0) { toast.error('Enter an amount in at least one box'); return }
    setPaying(true)
    try {
      const payload = {}
      const allocations = []
      payLines(payModal).forEach(l => {
        const fee  = num(payForm[l.fee.field])
        const misc = l.misc.field ? num(payForm[l.misc.field]) : 0
        if (l.current) {
          if (fee > 0)  payload.pay_current_fee   = fee
          if (misc > 0) payload.pay_misc_charges  = misc
        } else if (l.legacy) {
          if (fee > 0) allocations.push({ target: 'legacy', amount: fee })
        } else if (fee > 0 || misc > 0) {
          allocations.push({ target: l.id, fee, misc })
        }
      })
      if (allocations.length) payload.arrears_allocations = allocations
      await recordPayment(payModal.id, payload)
      toast.success(`Payment of ${rs(payTotal)} recorded`)
      setPayModal(null)
      setPayForm(EMPTY_PAY)
      load()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.non_field_errors?.[0]
        || d?.pay_previous_balance?.[0] || d?.pay_current_fee?.[0] || d?.pay_misc_charges?.[0]
        || d?.arrears_allocations?.[0] || d?.detail
        || 'Failed to record payment'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setPaying(false)
    }
  }

  const handleDownloadPdf = async (id, receiptNo) => {
    setPdfLoading(id)
    try {
      const { data: blob } = await downloadStudentInvoicePdf(id)
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Invoice_${receiptNo}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download PDF')
    } finally {
      setPdfLoading(null)
    }
  }

  const handleDownloadClassSheet = async () => {
    if (!filterMonth || !filterYear || !filterClass) return
    setPdfLoading('class')
    try {
      const { data: blob } = await downloadClassCollectionXlsx({
        current_class: filterClass, month: filterMonth, year: filterYear,
      })
      const url = URL.createObjectURL(new Blob([blob], { type: XLSX_MIME }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Fee_Collection_${filterClass}_${filterMonth}_${filterYear}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download collection sheet')
    } finally {
      setPdfLoading(null)
    }
  }

  const openEditModal = (record) => {
    setEditForm({
      previous_balance: record.previous_balance ?? '',
      current_fee: record.current_fee ?? '',
      amount_paid: record.amount_paid ?? '',
      status: record.status ?? 'unpaid',
      due_date: record.due_date ?? '',
      payment_date: record.payment_date ?? '',
      remarks: record.remarks ?? '',
    })
    setEditModal(record)
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    setEditing(true)
    try {
      const payload = { ...editForm }
      if (!payload.due_date) payload.due_date = null
      if (!payload.payment_date) payload.payment_date = null
      await editFeeRecord(editModal.id, payload)
      toast.success('Record updated')
      setEditModal(null)
      load()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.non_field_errors?.[0] || d?.detail
        || (typeof d === 'object' ? Object.values(d).flat()[0] : null) || 'Update failed'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setEditing(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteFeeRecord(deleteConfirm.id)
      toast.success('Record deleted')
      setDeleteConfirm(null)
      load()
    } catch {
      toast.error('Failed to delete record')
    } finally {
      setDeleting(false)
    }
  }

  const toggleAdvMonth = (m) => {
    setAdvMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a, b) => a - b))
  }

  const addAdvStudent = (s) => {
    if (!advSelected.find(x => x.id === s.id)) {
      setAdvSelected(prev => [...prev, s])
    }
    setAdvStudentSearch('')
    setAdvStudentOptions([])
  }

  const removeAdvStudent = (id) => {
    setAdvSelected(prev => prev.filter(x => x.id !== id))
  }

  const handleAdvancePayment = async (e) => {
    e.preventDefault()
    if (!advSelected.length || !advMonths.length) {
      toast.error('Select at least one student and one month')
      return
    }
    setAdvLoading(true)
    try {
      const payload = {
        student_ids: advSelected.map(s => s.id),
        months: advMonths,
        year: Number(advYear),
      }
      if (advAmount) payload.amount_paid = Number(advAmount)
      if (advRemarks) payload.remarks = advRemarks
      const { data: res } = await advancePayment(payload)
      toast.success(`Advance payment recorded — ${res.created} records created${res.skipped ? `, ${res.skipped} skipped` : ''}`)
      if (res.errors?.length) {
        res.errors.forEach(err => toast.error(err))
      }
      setAdvModal(false)
      setAdvSelected([])
      setAdvMonths([])
      setAdvAmount('')
      setAdvRemarks('')
      load()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.detail || d?.non_field_errors?.[0]
        || (typeof d === 'object' ? Object.values(d).flat()[0] : null) || 'Failed'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setAdvLoading(false)
    }
  }

  const clearFilters = () => {
    setSearch(''); setFilterStatus(''); setFilterMonth(''); setFilterYear('')
    setFilterClass(''); setFilterStudent('')
    setPage(1)
  }

  const totalPages = Math.ceil(count / PAGE_SIZE)
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, count)
  const hasFilters = search || filterStatus || filterClass || filterStudent
  const currentMonthLabel = MONTHS.find(m => m.v === Number(filterMonth))?.l ?? ''

  // A record row (shared shape between the main table and the lookup result)
  const recordRow = (r, actions = true) => {
    const isDefaulter = r.status === 'unpaid' || r.status === 'partial'
    const isAdvance = r.status === 'advance' || r.is_advance
    const s = r.student && typeof r.student === 'object' ? r.student : null
    return (
      <tr key={r.id} className={isDefaulter ? 'row-flag' : isAdvance ? 'row-info' : ''}>
        <td className="num text-[13px] text-accent">{r.receipt_display || r.receipt_no}</td>
        <td className="whitespace-nowrap">
          <Link
            href={`/students/${s ? s.id : r.student}`}
            className="font-medium text-ink hover:text-accent"
          >
            {s ? s.student_name : r.student_name}
          </Link>
          <span className="num text-[12px] text-ink-3 ml-1.5">#{s ? s.admission_no : r.admission_no}</span>
        </td>
        <td>{s ? s.current_class : r.current_class}</td>
        <td className="text-[13px] text-ink-2 whitespace-nowrap">{r.month_name} {r.year}</td>
        <td className="num text-right text-[13px]">
          {Number(r.previous_balance) > 0
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
          {Number(r.balance) > 0
            ? <span className="text-danger font-semibold">{rs(r.balance)}</span>
            : <span className="text-ink-3">0</span>}
        </td>
        <td>
          <span className="inline-flex items-center gap-1.5">
            <Badge value={r.status} />
            {r.is_late && (
              <Badge value="late" label="Late" title={r.late_paid_on ? `Paid late on ${r.late_paid_on}` : 'Paid after the month ended'} />
            )}
          </span>
        </td>
        <td className="whitespace-nowrap">
          <div className="flex items-center gap-0.5">
            {/* PARITY: Pay only while not paid/waived */}
            {actions && r.status !== 'paid' && r.status !== 'waived' && (
              <button className="btn btn-ghost btn-sm text-accent px-2"
                onClick={() => openPayModal(r)}>
                Pay
              </button>
            )}
            <button className="btn btn-ghost btn-sm px-1.5"
              onClick={() => openEditModal(r)} title="Edit record" aria-label="Edit record">
              <Icon name="pencil" size={15} />
            </button>
            {actions && (
              <button className="btn btn-ghost btn-sm px-1.5 hover:!text-danger"
                onClick={() => setDeleteConfirm(r)} title="Delete record" aria-label="Delete record">
                <Icon name="trash" size={15} />
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm px-1.5"
              onClick={() => handleDownloadPdf(r.id, r.receipt_display || r.receipt_no)}
              disabled={pdfLoading === r.id}
              title="Download PDF invoice" aria-label="Download PDF invoice"
            >
              {pdfLoading === r.id ? <Spinner /> : <Icon name="download" size={15} />}
            </button>
            <a href={`/fees/invoice/${r.id}`} target="_blank" rel="noopener"
              className="btn btn-ghost btn-sm px-1.5" title="Print invoice" aria-label="Print invoice">
              <Icon name="printer" size={15} />
            </a>
          </div>
        </td>
      </tr>
    )
  }

  const tableHead = (
    <thead>
      <tr>
        <th>Receipt</th>
        <th>Student</th>
        <th>Class</th>
        <th>Period</th>
        <th className="text-right">Prev bal</th>
        <th className="text-right">Fee</th>
        <th className="text-right">Misc.</th>
        <th className="text-right">Total</th>
        <th className="text-right">Paid</th>
        <th className="text-right">Balance</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
  )

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Fee records</h1>
          <p className="num text-[13px] text-ink-3 mt-1">
            {filterMonth && filterYear
              ? `${currentMonthLabel} ${filterYear} — ${count} records`
              : `${count} total records`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {filterMonth && filterYear && filterClass && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleDownloadClassSheet}
                disabled={pdfLoading === 'class'}
              >
                <Icon name="download" size={16} />
                {pdfLoading === 'class' ? 'Downloading…' : 'Collection sheet (Excel)'}
              </button>
              <a
                href={`/fees/invoice/class?class=${encodeURIComponent(filterClass)}&month=${filterMonth}&year=${filterYear}`}
                target="_blank"
                rel="noopener"
                className="btn btn-secondary"
              >
                <Icon name="printer" size={16} />
                Print class sheet
              </a>
            </>
          )}
          <button className="btn btn-secondary" onClick={() => setAdvModal(true)}>
            <Icon name="card" size={16} />
            Advance payment
          </button>
          <button className="btn btn-primary" onClick={() => setCreateModal(true)}>
            <Icon name="plus" size={16} />
            New record
          </button>
        </div>
      </div>

      {/* Receipt lookup */}
      <div className="panel p-4">
        <p className="label mb-3">Receipt lookup</p>
        <form onSubmit={handleReceiptLookup} className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <input
              className="input"
              placeholder="Enter receipt no. (e.g. 2026-0001 or just 0001)…"
              value={receiptQuery}
              onChange={e => setReceiptQuery(e.target.value)}
              aria-label="Receipt number"
            />
          </div>
          <button
            type="submit"
            disabled={receiptSearching || !receiptQuery.trim()}
            className="btn btn-primary"
          >
            {receiptSearching ? (<><Spinner /> Searching…</>) : 'Find'}
          </button>
          {(receiptResult || receiptError) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setReceiptResult(null); setReceiptError(''); setReceiptQuery('') }}
            >
              Clear
            </button>
          )}
        </form>

        {receiptError && (
          <p className="mt-2 text-[13.5px] text-danger">{receiptError}</p>
        )}

        {receiptResult && (
          <div className="mt-3 overflow-x-auto border-t border-rule pt-1">
            <table className="ledger min-w-[1150px]">
              {tableHead}
              <tbody>
                {recordRow(receiptResult, false)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Period filter */}
      <div className="panel p-4">
        <p className="label mb-3">Filter period</p>
        <div className="flex flex-wrap gap-3">
          <select className="input w-44" value={filterMonth} aria-label="Month"
            onChange={e => { setFilterMonth(e.target.value); setPage(1) }}>
            <option value="">All months</option>
            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
          <select className="input w-32" value={filterYear} aria-label="Year"
            onChange={e => { setFilterYear(e.target.value); setPage(1) }}>
            <option value="">All years</option>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="input w-52" value={filterClass} aria-label="Class"
            onChange={e => { setFilterClass(e.target.value); setPage(1) }}>
            <option value="">All classes</option>
            {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Extra filters */}
      <div className="flex flex-wrap gap-3">
        <input className="input flex-1 min-w-[200px]" placeholder="Search receipt, student name, admission no.…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className="input w-36" value={filterStatus} aria-label="Status"
          onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        {hasFilters && <button className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}
      </div>

      {/* Table — skeleton only on first load; refetches keep rows on screen */}
      <div className="panel overflow-hidden">
        {loading && data.length === 0 ? (
          <TableSkeleton rows={10} cols={9} />
        ) : data.length === 0 ? (
          <EmptyState
            message="No fee records found for this period."
            action={
              <>
                {hasFilters && <button className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}
                <button className="btn btn-primary" onClick={() => setCreateModal(true)}>New record</button>
              </>
            }
          />
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity duration-120 ${loading ? 'opacity-60' : ''}`}>
              <table className="ledger min-w-[1150px]">
                {tableHead}
                <tbody>
                  {data.map(r => recordRow(r))}
                </tbody>
              </table>
            </div>

            {/* Page totals */}
            <div className="border-t border-rule px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              <span className="text-ink-2">
                Showing <strong className="num text-ink">{from}–{to}</strong> of <span className="num">{count}</span>
              </span>
              <span className="text-ink-2">
                Total due <strong className="num text-ink">Rs {data.reduce((s, r) => s + Number(r.total_amount), 0).toLocaleString()}</strong>
              </span>
              <span className="text-ok">
                Collected <strong className="num">Rs {data.reduce((s, r) => s + Number(r.amount_paid), 0).toLocaleString()}</strong>
              </span>
              <span className="text-danger">
                Balance <strong className="num">Rs {data.reduce((s, r) => s + Number(r.balance), 0).toLocaleString()}</strong>
              </span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-rule px-4 py-3">
                <p className="num text-[13px] text-ink-2">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn btn-secondary btn-sm">Previous</button>
                  <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="btn btn-secondary btn-sm">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New fee record" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Student <span className="text-danger">*</span></label>
            <input className="input" placeholder="Type name or admission no. to search…"
              value={studentSearch} onChange={e => setStudentSearch(e.target.value)} />
            {studentOptions.length > 0 && studentSearch && (
              <div className="border border-edge rounded-control mt-1 max-h-40 overflow-y-auto shadow-overlay bg-surface">
                {studentOptions.map(s => (
                  <button key={s.id} type="button"
                    className="w-full text-left px-3 py-2 text-[13.5px] hover:bg-surface-sunken flex items-center justify-between gap-3"
                    onClick={() => {
                      setCreateForm({ ...createForm, student: s.id })
                      setStudentSearch(`${s.student_name} (#${s.admission_no}) — ${s.current_class}`)
                      setStudentOptions([])
                    }}>
                    <span className="font-medium text-ink">{s.student_name}</span>
                    <span className="num text-ink-3 text-[12px]">
                      #{s.admission_no} · {s.current_class}
                      {s.current_fee ? ` · Rs ${Number(s.current_fee).toLocaleString()}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {createForm.student && <p className="text-[13px] text-ok mt-1">Student selected</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Month <span className="text-danger">*</span></label>
              <select className="input" value={createForm.month}
                onChange={e => setCreateForm({ ...createForm, month: e.target.value })} required>
                {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Year <span className="text-danger">*</span></label>
              <input className="input" type="number" min="2020" max="2099"
                value={createForm.year} onChange={e => setCreateForm({ ...createForm, year: e.target.value })} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Previous balance (Rs)</label>
              <input className="input" type="number" min="0" placeholder="Auto from arrears"
                value={createForm.previous_balance}
                onChange={e => setCreateForm({ ...createForm, previous_balance: e.target.value })} />
            </div>
            <div>
              <label className="label">Current fee (Rs)</label>
              <input className="input" type="number" min="0" placeholder="Auto from student/class"
                value={createForm.current_fee}
                onChange={e => setCreateForm({ ...createForm, current_fee: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Amount paid now (Rs)</label>
              <input className="input" type="number" min="0"
                value={createForm.amount_paid}
                onChange={e => setCreateForm({ ...createForm, amount_paid: e.target.value })} />
            </div>
            <div>
              <label className="label">Due date</label>
              <input className="input" type="date" value={createForm.due_date}
                onChange={e => setCreateForm({ ...createForm, due_date: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setCreateModal(false)}>Cancel</button>
            <button type="submit" disabled={creating || !createForm.student} className="btn btn-primary">
              {creating ? (<><Spinner /> Creating…</>) : 'Create record'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Payment modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title="Record payment" size="lg">
        {payModal && (() => {
          const lines = payLines(payModal)
          const hasCharges = lines.some(l => l.misc.billed > 0)
          const newBalance = num(payModal.balance) - payTotal
          const fillAll = () => setPayForm(lines.reduce((acc, l) => {
            if (l.fee.max > 0) acc[l.fee.field] = String(l.fee.max)
            if (l.misc.field && l.misc.max > 0) acc[l.misc.field] = String(l.misc.max)
            return acc
          }, {}))
          const box = (slot, label) => (slot.field && slot.billed > 0) ? (
            <input
              className="input text-right w-32 ml-auto"
              type="number" min="0" step="1" max={slot.max}
              disabled={slot.max <= 0}
              placeholder={slot.max > 0 ? `Max ${slot.max.toLocaleString()}` : 'Settled'}
              value={payForm[slot.field] ?? ''}
              onChange={e => setPayForm({ ...payForm, [slot.field]: e.target.value })}
              aria-label={label}
            />
          ) : <span className="text-ink-3">—</span>
          const owed = (slot, cls) => slot.billed > 0
            ? (slot.max > 0 ? <span className={`${cls} font-semibold`}>{rs(slot.max)}</span> : <span className="text-ink-3">0</span>)
            : <span className="text-ink-3">—</span>

          return (
            <form onSubmit={handlePayment} className="space-y-4">
              <div className="rounded-control bg-surface-sunken p-4 text-[13.5px] space-y-1">
                <p><span className="text-ink-2">Receipt:</span> <strong className="num text-ink">{payModal.receipt_display || payModal.receipt_no}</strong></p>
                <p><span className="text-ink-2">Student:</span> <strong className="text-ink">{payModal.student_name}</strong> <span className="num text-ink-3">(#{payModal.admission_no})</span></p>
                <p><span className="text-ink-2">Period:</span> {payModal.month_name} {payModal.year}</p>
              </div>

              {!arrears && (
                <p className="text-[13px] text-ink-3 flex items-center gap-2"><Spinner /> Checking earlier months…</p>
              )}

              {/* One line per month owed; fee and charges each get their own box */}
              <div className="overflow-x-auto">
                <table className={`ledger ${hasCharges ? 'min-w-[640px]' : 'min-w-[440px]'}`}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="text-right">Fee owed</th>
                      <th className="text-right w-36">Paying</th>
                      {hasCharges && (
                        <>
                          <th className="text-right">Charges owed</th>
                          <th className="text-right w-36">Paying</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.key} className={l.current ? '' : 'row-flag'}>
                        <td>
                          <span className="font-medium block leading-tight">{l.label}</span>
                          <span className="text-[12px] text-ink-3">{l.sub}</span>
                        </td>
                        <td className="num text-right">{owed(l.fee, 'text-danger')}</td>
                        <td className="text-right">{box(l.fee, `Fee for ${l.label}`)}</td>
                        {hasCharges && (
                          <>
                            <td className="num text-right">{owed(l.misc, 'text-info')}</td>
                            <td className="text-right">{box(l.misc, `Charges for ${l.label}`)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {lines.length > 1 && (
                <p className="text-[12.5px] text-ink-3">
                  Amounts entered against an earlier month are recorded on that month&apos;s record and marked as paid late.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn btn-secondary btn-sm" onClick={fillAll}>
                  Pay full balance
                </button>
                <div className="text-[13.5px] text-right space-y-0.5">
                  <p>
                    <span className="text-ink-2">Paying now:</span>{' '}
                    <strong className="num text-ink">{rs(payTotal)}</strong>
                  </p>
                  <p>
                    <span className="text-ink-2">Balance after:</span>{' '}
                    <strong className={`num ${newBalance > 0 ? 'text-danger' : 'text-ok'}`}>{rs(newBalance)}</strong>
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" className="btn btn-secondary" onClick={() => setPayModal(null)}>Cancel</button>
                <button type="submit" disabled={paying || payTotal <= 0} className="btn btn-primary">
                  {paying ? (<><Spinner /> Saving…</>) : 'Record payment'}
                </button>
              </div>
            </form>
          )
        })()}
      </Modal>

      {/* Edit record modal */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit fee record" size="md">
        {editModal && (
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="rounded-control bg-surface-sunken p-3 text-[13.5px] space-y-1">
              <p><span className="text-ink-2">Receipt:</span> <strong className="num text-ink">{editModal.receipt_display || editModal.receipt_no}</strong></p>
              <p>
                <span className="text-ink-2">Student:</span>{' '}
                <strong className="text-ink">
                  {editModal.student_name ?? editModal.student?.student_name}
                </strong>{' '}
                <span className="num text-ink-3">(#{editModal.admission_no ?? editModal.student?.admission_no})</span>
              </p>
              <p><span className="text-ink-2">Period:</span> {editModal.month_name} {editModal.year}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Previous balance (Rs)</label>
                <input className="input" type="number" min="0"
                  value={editForm.previous_balance}
                  onChange={e => setEditForm({ ...editForm, previous_balance: e.target.value })} />
              </div>
              <div>
                <label className="label">Current fee (Rs)</label>
                <input className="input" type="number" min="0"
                  value={editForm.current_fee}
                  onChange={e => setEditForm({ ...editForm, current_fee: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Amount paid (Rs)</label>
                <input className="input" type="number" min="0"
                  value={editForm.amount_paid}
                  onChange={e => setEditForm({ ...editForm, amount_paid: e.target.value })} />
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Due date</label>
                <input className="input" type="date" value={editForm.due_date || ''}
                  onChange={e => setEditForm({ ...editForm, due_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Payment date</label>
                <input className="input" type="date" value={editForm.payment_date || ''}
                  onChange={e => setEditForm({ ...editForm, payment_date: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">Remarks</label>
              <textarea className="input" rows={2} value={editForm.remarks}
                onChange={e => setEditForm({ ...editForm, remarks: e.target.value })} />
            </div>

            <div className="rounded-control bg-surface-sunken p-3 text-[13px] text-ink-2">
              Total and balance will be auto-calculated. If you set status to "Waived", the balance becomes 0.
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button type="submit" disabled={editing} className="btn btn-primary">
                {editing ? (<><Spinner /> Saving…</>) : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete fee record" size="sm">
        {deleteConfirm && (
          <div className="space-y-4">
            <div className="rounded-control bg-danger-tint p-4 text-[13.5px] space-y-1">
              <p className="text-danger font-semibold">Are you sure you want to delete this record?</p>
              <p className="text-ink-2 mt-2">
                Receipt: <strong className="num text-ink">{deleteConfirm.receipt_display || deleteConfirm.receipt_no}</strong>
              </p>
              <p className="text-ink-2">
                Student: <strong className="text-ink">{deleteConfirm.student_name}</strong>
              </p>
              <p className="text-ink-2">
                Period: {deleteConfirm.month_name} {deleteConfirm.year}
              </p>
              <p className="text-ink-2">
                Amount: <span className="num">{rs(deleteConfirm.total_amount)}</span>
              </p>
              <p className="text-[13px] text-danger mt-2">This action cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger-solid" onClick={handleDelete} disabled={deleting}>
                {deleting ? (<><Spinner /> Deleting…</>) : 'Delete record'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Advance payment modal */}
      <Modal open={advModal} onClose={() => setAdvModal(false)} title="Advance fee payment" size="lg">
        <form onSubmit={handleAdvancePayment} className="space-y-4">
          <div className="rounded-control bg-info-tint p-3.5 text-[13.5px] text-info">
            Record advance fee payment for one or more students across multiple months.
            Fee records will be created for each selected month marked as "Paid in advance".
          </div>

          {/* Student search */}
          <div>
            <label className="label">Select students <span className="text-danger">*</span></label>
            <input className="input" placeholder="Search by name or admission no.…"
              value={advStudentSearch} onChange={e => setAdvStudentSearch(e.target.value)} />
            {advStudentOptions.length > 0 && advStudentSearch && (
              <div className="border border-edge rounded-control mt-1 max-h-40 overflow-y-auto shadow-overlay bg-surface">
                {advStudentOptions.map(s => (
                  <button key={s.id} type="button"
                    className="w-full text-left px-3 py-2 text-[13.5px] hover:bg-surface-sunken flex items-center justify-between gap-3"
                    onClick={() => addAdvStudent(s)}>
                    <span className="font-medium text-ink">{s.student_name}</span>
                    <span className="num text-ink-3 text-[12px]">#{s.admission_no} · {s.current_class}
                      {s.current_fee ? ` · Rs ${Number(s.current_fee).toLocaleString()}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {advSelected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {advSelected.map(s => (
                <span key={s.id} className="badge badge-info">
                  {s.student_name} <span className="num opacity-70">#{s.admission_no}</span>
                  <button type="button" onClick={() => removeAdvStudent(s.id)}
                    aria-label={`Remove ${s.student_name}`}
                    className="ml-1 opacity-70 hover:opacity-100">&times;</button>
                </span>
              ))}
            </div>
          )}

          {/* Year */}
          <div>
            <label className="label">Year <span className="text-danger">*</span></label>
            <select className="input w-36" value={advYear} onChange={e => setAdvYear(e.target.value)}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Month grid */}
          <div>
            <label className="label">Select months <span className="text-danger">*</span></label>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {MONTHS.map(m => {
                const sel = advMonths.includes(m.v)
                return (
                  <button key={m.v} type="button"
                    onClick={() => toggleAdvMonth(m.v)}
                    aria-pressed={sel}
                    className={`h-9 rounded-control text-[13px] font-medium border transition-colors duration-120 ${
                      sel
                        ? 'bg-accent text-on-accent border-accent'
                        : 'bg-surface text-ink-2 border-edge hover:border-accent hover:text-ink'
                    }`}>
                    {m.l.substring(0, 3)}
                  </button>
                )
              })}
            </div>
            {advMonths.length > 0 && (
              <p className="text-[13px] text-accent mt-1.5">
                {advMonths.length} month(s) selected: {advMonths.map(m => MONTHS.find(x => x.v === m)?.l.substring(0, 3)).join(', ')}
              </p>
            )}
          </div>

          {/* Amount override */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Fee per month (Rs)</label>
              <input className="input" type="number" min="0" placeholder="Auto from student/class fee"
                value={advAmount} onChange={e => setAdvAmount(e.target.value)} />
              <p className="text-[13px] text-ink-3 mt-0.5">Leave blank to use each student's fee</p>
            </div>
            <div>
              <label className="label">Remarks</label>
              <input className="input" placeholder="e.g. Advance payment for Jul–Sep"
                value={advRemarks} onChange={e => setAdvRemarks(e.target.value)} />
            </div>
          </div>

          {/* Summary */}
          {advSelected.length > 0 && advMonths.length > 0 && (
            <div className="rounded-control bg-surface-sunken p-3 text-[13.5px] space-y-1">
              <p className="font-medium text-ink">Summary</p>
              <p className="text-ink-2">
                <strong className="num">{advSelected.length}</strong> student(s) &times;{' '}
                <strong className="num">{advMonths.length}</strong> month(s) ={' '}
                <strong className="num">{advSelected.length * advMonths.length}</strong> records to create
              </p>
              {advAmount && (
                <p className="text-ink-2">
                  Total: <strong className="num text-accent">Rs {(Number(advAmount) * advSelected.length * advMonths.length).toLocaleString()}</strong>
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setAdvModal(false)}>Cancel</button>
            <button type="submit"
              disabled={advLoading || !advSelected.length || !advMonths.length}
              className="btn btn-primary">
              {advLoading ? (<><Spinner /> Processing…</>) : 'Record advance payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default function FeeRecordsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-content mx-auto px-6 py-6">
        <div className="panel"><TableSkeleton rows={10} cols={9} /></div>
      </div>
    }>
      <FeeRecordsInner />
    </Suspense>
  )
}
