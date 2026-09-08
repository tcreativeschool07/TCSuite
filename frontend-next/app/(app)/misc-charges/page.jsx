'use client'

// Misc. charges — filter/pagination/create/delete logic verbatim from
// pages/fees/MiscCharges.jsx (including the category → amount auto-fill).
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  getMiscCharges, createMiscCharge, deleteMiscCharge,
  getChargeCategories,
} from '@/src/api/feesApi'
import { getStudents } from '@/src/api/studentsApi'
import Badge from '@/src/components/Badge'
import Modal from '@/src/components/Modal'
import useYears from '@/src/hooks/useYears'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const MONTHS = [
  { v: 1,  l: 'January'  }, { v: 2,  l: 'February' }, { v: 3,  l: 'March'     },
  { v: 4,  l: 'April'    }, { v: 5,  l: 'May'       }, { v: 6,  l: 'June'      },
  { v: 7,  l: 'July'     }, { v: 8,  l: 'August'    }, { v: 9,  l: 'September' },
  { v: 10, l: 'October'  }, { v: 11, l: 'November'  }, { v: 12, l: 'December'  },
]

const NOW = new Date()
const rs = (v) => `Rs ${Number(v).toLocaleString()}`

export default function MiscCharges() {
  const yearOptions = useYears()

  const [data, setData]       = useState([])
  const [count, setCount]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const PAGE_SIZE = 25

  const [search, setSearch]           = useState('')
  const [filterMonth, setFilterMonth] = useState(String(NOW.getMonth() + 1))
  const [filterYear, setFilterYear]   = useState(String(NOW.getFullYear()))

  const [categories, setCategories] = useState([])

  const [createModal, setCreateModal]       = useState(false)
  const [creating, setCreating]             = useState(false)
  const [studentSearch, setStudentSearch]   = useState('')
  const [studentOptions, setStudentOptions] = useState([])
  const [createForm, setCreateForm]         = useState({
    student: '', category: '', amount: '', month: NOW.getMonth() + 1,
    year: NOW.getFullYear(), remarks: '',
  })

  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]           = useState(false)

  useEffect(() => {
    getChargeCategories()
      .then(({ data: res }) => setCategories((res.results ?? res).filter(c => c.is_active !== false)))
      .catch(() => {})
  }, [])

  const buildParams = useCallback(() => {
    const p = { page, page_size: PAGE_SIZE }
    if (search)      p.search = search
    if (filterMonth) p.month  = filterMonth
    if (filterYear)  p.year   = filterYear
    return p
  }, [page, search, filterMonth, filterYear])

  const load = useCallback(() => {
    setLoading(true)
    getMiscCharges(buildParams())
      .then(({ data: res }) => {
        setData(res.results ?? res)
        setCount(res.count ?? (res.results ?? res).length)
      })
      .catch(() => toast.error('Failed to load misc charges'))
      .finally(() => setLoading(false))
  }, [buildParams])

  useEffect(() => { load() }, [load])

  // 250ms debounce: one lookup per pause in typing, not one per keystroke.
  useEffect(() => {
    if (studentSearch.length < 2) { setStudentOptions([]); return }
    const t = setTimeout(() => {
      getStudents({ search: studentSearch, page_size: 10 })
        .then(({ data: res }) => setStudentOptions(res.results ?? res))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [studentSearch])

  const handleCategoryChange = (categoryId) => {
    const cat = categories.find(c => String(c.id) === String(categoryId))
    setCreateForm(prev => ({
      ...prev,
      category: categoryId,
      amount: cat?.default_amount ?? cat?.amount ?? '',
    }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      await createMiscCharge({
        student: createForm.student,
        category: createForm.category,
        amount: createForm.amount,
        month: createForm.month,
        year: createForm.year,
        remarks: createForm.remarks,
      })
      toast.success('Misc charge created successfully')
      setCreateModal(false)
      setCreateForm({
        student: '', category: '', amount: '', month: NOW.getMonth() + 1,
        year: NOW.getFullYear(), remarks: '',
      })
      setStudentSearch('')
      load()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.non_field_errors?.[0] || d?.detail
        || (typeof d === 'object' ? Object.values(d).flat()[0] : null) || 'Failed to create charge'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteMiscCharge(deleteConfirm.id)
      toast.success('Charge deleted')
      setDeleteConfirm(null)
      load()
    } catch {
      toast.error('Failed to delete charge')
    } finally {
      setDeleting(false)
    }
  }

  const clearFilters = () => {
    setSearch(''); setFilterMonth(''); setFilterYear('')
    setPage(1)
  }

  const totalPages = Math.ceil(count / PAGE_SIZE)
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, count)
  const hasFilters = search
  const currentMonthLabel = MONTHS.find(m => m.v === Number(filterMonth))?.l ?? ''

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Misc. charges</h1>
          <p className="num text-[13px] text-ink-3 mt-1">
            {filterMonth && filterYear
              ? `${currentMonthLabel} ${filterYear} — ${count} charges`
              : `${count} total charges`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateModal(true)}>
          <Icon name="plus" size={16} />
          Add charge
        </button>
      </div>

      {/* Filters */}
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
          <input className="input flex-1 min-w-[200px]" placeholder="Search by student name or admission no.…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          {hasFilters && <button className="btn btn-secondary" onClick={clearFilters}>Clear</button>}
        </div>
      </div>

      {/* Table — skeleton only on first load; refetches keep rows on screen */}
      <div className="panel overflow-hidden">
        {loading && data.length === 0 ? (
          <TableSkeleton rows={8} cols={8} />
        ) : data.length === 0 ? (
          <EmptyState
            message="No misc charges found for this period."
            action={<button className="btn btn-primary" onClick={() => setCreateModal(true)}>Add charge</button>}
          />
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity duration-120 ${loading ? 'opacity-60' : ''}`}>
              <table className="ledger min-w-[900px]">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Admission no.</th>
                    <th>Class</th>
                    <th>Category</th>
                    <th className="text-right">Amount</th>
                    <th>Month / year</th>
                    <th>Date</th>
                    <th>Remarks</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(r => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.student_name}</td>
                      <td className="num text-[13px] text-ink-2">#{r.admission_no}</td>
                      <td>{r.current_class}</td>
                      <td>
                        <Badge value={r.category_name || r.category} />
                      </td>
                      <td className="num text-right">{rs(r.amount)}</td>
                      <td className="text-[13px] text-ink-2">
                        {MONTHS.find(m => m.v === r.month)?.l ?? r.month} {r.year}
                      </td>
                      <td className="num text-[13px] text-ink-2">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
                      <td className="text-[13px] text-ink-2 max-w-[150px] truncate">{r.remarks || '—'}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm hover:!text-danger"
                          onClick={() => setDeleteConfirm(r)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-rule px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              <span className="text-ink-2">
                Showing <strong className="num text-ink">{from}–{to}</strong> of <span className="num">{count}</span>
              </span>
              <span className="text-ink-2">
                Total <strong className="num text-ink">Rs {data.reduce((s, r) => s + Number(r.amount), 0).toLocaleString()}</strong>
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

      {/* Add charge modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Add misc charge" size="md">
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
                    <span className="num text-ink-3 text-[12px]">#{s.admission_no} · {s.current_class}</span>
                  </button>
                ))}
              </div>
            )}
            {createForm.student && <p className="text-[13px] text-ok mt-1">Student selected</p>}
          </div>

          <div>
            <label className="label">Category <span className="text-danger">*</span></label>
            <select className="input" value={createForm.category}
              onChange={e => handleCategoryChange(e.target.value)} required>
              <option value="">Select category…</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Amount (Rs) <span className="text-danger">*</span></label>
            <input className="input" type="number" min="0" step="any"
              value={createForm.amount}
              onChange={e => setCreateForm({ ...createForm, amount: e.target.value })}
              required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Month <span className="text-danger">*</span></label>
              <select className="input" value={createForm.month}
                onChange={e => setCreateForm({ ...createForm, month: Number(e.target.value) })} required>
                {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Year <span className="text-danger">*</span></label>
              <select className="input" value={createForm.year}
                onChange={e => setCreateForm({ ...createForm, year: Number(e.target.value) })} required>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Remarks</label>
            <textarea className="input" rows={3} placeholder="Optional remarks…"
              value={createForm.remarks}
              onChange={e => setCreateForm({ ...createForm, remarks: e.target.value })} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setCreateModal(false)}>Cancel</button>
            <button type="submit" disabled={creating || !createForm.student || !createForm.category} className="btn btn-primary">
              {creating ? (<><Spinner /> Creating…</>) : 'Add charge'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete misc charge" size="sm">
        {deleteConfirm && (
          <div className="space-y-4">
            <div className="rounded-control bg-danger-tint p-4 text-[13.5px] space-y-1">
              <p className="text-danger font-semibold">Are you sure you want to delete this charge?</p>
              <p className="text-ink-2 mt-2">
                Student: <strong className="text-ink">{deleteConfirm.student_name}</strong>
              </p>
              <p className="text-ink-2">
                Category: <strong className="text-ink">{deleteConfirm.category_name || deleteConfirm.category}</strong>
              </p>
              <p className="text-ink-2">
                Amount: <span className="num">{rs(deleteConfirm.amount)}</span>
              </p>
              <p className="text-[13px] text-danger mt-2">This action cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger-solid" onClick={handleDelete} disabled={deleting}>
                {deleting ? (<><Spinner /> Deleting…</>) : 'Delete charge'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
