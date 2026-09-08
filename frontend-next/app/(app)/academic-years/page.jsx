'use client'

// Academic years — CRUD logic verbatim from pages/fees/AcademicYears.jsx.
// PARITY: the old page marked the current year with <Badge value="paid"
// label="Current" /> (borrowing the green variant); kept as-is.
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  getAcademicYears, createAcademicYear,
  updateAcademicYear, deleteAcademicYear,
} from '@/src/api/feesApi'
import Modal from '@/src/components/Modal'
import Badge from '@/src/components/Badge'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const EMPTY = { label: '', start_date: '', end_date: '', is_current: false }

export default function AcademicYears() {
  const [years, setYears]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [editId, setEditId]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [deleteId, setDeleteId] = useState(null)

  const load = () => {
    setLoading(true)
    getAcademicYears()
      .then(({ data }) => setYears(data.results ?? data))
      .catch(() => toast.error('Failed to load academic years'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('edit') }
  const openEdit = (y) => {
    setForm({ label: y.label, start_date: y.start_date, end_date: y.end_date, is_current: y.is_current })
    setEditId(y.id)
    setModal('edit')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) {
        await updateAcademicYear(editId, form)
        toast.success('Academic year updated')
      } else {
        await createAcademicYear(form)
        toast.success('Academic year created')
      }
      setModal(null)
      load()
    } catch (err) {
      const msg = err.response?.data?.detail
        || err.response?.data?.label?.[0]
        || (typeof err.response?.data === 'object' ? Object.values(err.response.data).flat()[0] : null)
        || 'Failed to save'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteAcademicYear(deleteId)
      toast.success('Academic year deleted')
      setDeleteId(null)
      load()
    } catch {
      toast.error('Failed to delete academic year')
    }
  }

  const currentYear = years.find(y => y.is_current)

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Academic years</h1>
          <p className="text-[13px] text-ink-3 mt-1">
            {currentYear
              ? `Current: ${currentYear.label}`
              : 'No current academic year set'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={16} />
          Add academic year
        </button>
      </div>

      {/* Current year banner */}
      {currentYear && (
        <div className="panel p-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-accent-tint text-accent flex items-center justify-center shrink-0" aria-hidden="true">
            <Icon name="calendar" size={18} />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-ink">
              Current academic year: {currentYear.label}
            </p>
            {(currentYear.start_date || currentYear.end_date) && (
              <p className="num text-[13px] text-ink-2">
                {currentYear.start_date || '?'} — {currentYear.end_date || '?'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : years.length === 0 ? (
          <EmptyState
            message="No academic years yet."
            action={<button className="btn btn-primary" onClick={openAdd}>Add academic year</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger min-w-[640px]">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Start date</th>
                  <th>End date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.id}>
                    <td className="font-medium">{y.label}</td>
                    <td className="num text-ink-2">{y.start_date || '—'}</td>
                    <td className="num text-ink-2">{y.end_date || '—'}</td>
                    <td>
                      {y.is_current
                        ? <Badge value="paid" label="Current" />
                        : <span className="text-[13px] text-ink-3">Past</span>
                      }
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(y)} className="btn btn-ghost btn-sm">Edit</button>
                        <button onClick={() => setDeleteId(y.id)} className="btn btn-ghost btn-sm hover:!text-danger">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/edit modal */}
      <Modal open={modal === 'edit'} onClose={() => setModal(null)}
        title={editId ? 'Edit academic year' : 'Add academic year'} size="sm">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Label <span className="text-danger">*</span></label>
            <input className="input" placeholder="e.g. 2025-2026"
              value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Start date</label>
              <input className="input" type="date"
                value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label className="label">End date</label>
              <input className="input" type="date"
                value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input id="ay_current" type="checkbox" className="accent-[var(--accent)]"
              checked={form.is_current} onChange={e => setForm({ ...form, is_current: e.target.checked })} />
            <label htmlFor="ay_current" className="text-[13.5px] text-ink">Mark as current year</label>
          </div>
          <p className="text-[13px] text-ink-3">
            Only one academic year can be current at a time. Enabling this will automatically deactivate the previous current year.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? (<><Spinner /> Saving…</>) : editId ? 'Save changes' : 'Create year'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete academic year" size="sm">
        <p className="text-[14px] text-ink-2">
          Delete this academic year? This will not affect any fee records.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDelete}>Delete year</button>
        </div>
      </Modal>
    </div>
  )
}
