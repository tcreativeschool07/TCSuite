'use client'

// Fee structures — CRUD logic verbatim from pages/fees/FeeStructures.jsx.
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  getFeeStructures,
  createFeeStructure,
  updateFeeStructure,
  deleteFeeStructure,
} from '@/src/api/feesApi'
import Modal from '@/src/components/Modal'
import Badge from '@/src/components/Badge'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const EMPTY = { class_name: '', monthly_fee: '', description: '', is_active: true }

export default function FeeStructures() {
  const [structures, setStructures] = useState([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState(null)   // null | 'edit'
  const [form, setForm]             = useState(EMPTY)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [deleteId, setDeleteId]     = useState(null)

  const load = () => {
    setLoading(true)
    getFeeStructures()
      .then(({ data }) => setStructures(data.results ?? data))
      .catch(() => toast.error('Failed to load fee structures'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('edit') }
  const openEdit = (s) => { setForm({ ...s }); setEditId(s.id); setModal('edit') }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) {
        await updateFeeStructure(editId, form)
        toast.success('Fee structure updated')
      } else {
        await createFeeStructure(form)
        toast.success('Fee structure created')
      }
      setModal(null)
      load()
    } catch (err) {
      const msg = err.response?.data?.detail
        || Object.values(err.response?.data ?? {})[0]
        || 'Failed to save'
      toast.error(Array.isArray(msg) ? msg[0] : msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteFeeStructure(deleteId)
      toast.success('Deleted')
      setDeleteId(null)
      load()
    } catch {
      toast.error('Cannot delete — fee records may reference this structure')
    }
  }

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Fee structures</h1>
          <p className="text-[13px] text-ink-3 mt-1">Monthly fee per class</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={16} />
          Add structure
        </button>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : structures.length === 0 ? (
          <EmptyState
            message="No fee structures yet."
            action={<button className="btn btn-primary" onClick={openAdd}>Add structure</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger min-w-[640px]">
              <thead>
                <tr>
                  <th>Class</th>
                  <th className="text-right">Monthly fee</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {structures.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.class_name}</td>
                    <td className="num text-right">Rs {Number(s.monthly_fee).toLocaleString()}</td>
                    <td className="text-ink-2">{s.description || '—'}</td>
                    <td>
                      <Badge value={s.is_active ? 'active' : 'inactive'} label={s.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(s)} className="btn btn-ghost btn-sm">Edit</button>
                        <button onClick={() => setDeleteId(s.id)} className="btn btn-ghost btn-sm hover:!text-danger">Delete</button>
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
      <Modal
        open={modal === 'edit'}
        onClose={() => setModal(null)}
        title={editId ? 'Edit fee structure' : 'Add fee structure'}
        size="sm"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Class name <span className="text-danger">*</span></label>
            <input
              className="input"
              placeholder="e.g. Class 5 or Nursery"
              value={form.class_name}
              onChange={(e) => setForm({ ...form, class_name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Monthly fee (Rs) <span className="text-danger">*</span></label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="2500"
              value={form.monthly_fee}
              onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input resize-none min-h-[80px]"
              placeholder="Optional notes about this fee structure…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="is_active"
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor="is_active" className="text-[13.5px] text-ink">Active</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? (<><Spinner /> Saving…</>) : editId ? 'Save changes' : 'Create structure'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete fee structure" size="sm">
        <p className="text-[14px] text-ink-2">
          Delete this fee structure? It cannot be deleted if fee records reference it.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDelete}>Delete structure</button>
        </div>
      </Modal>
    </div>
  )
}
