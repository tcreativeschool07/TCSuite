'use client'

// Charge categories — CRUD + client-side search, verbatim from
// pages/fees/ChargeCategories.jsx.
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  getChargeCategories, createChargeCategory,
  updateChargeCategory, deleteChargeCategory,
} from '@/src/api/feesApi'
import Modal from '@/src/components/Modal'
import Badge from '@/src/components/Badge'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const EMPTY = { name: '', amount: '', description: '', is_active: true }

export default function ChargeCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState(null)
  const [form, setForm]             = useState(EMPTY)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [deleteId, setDeleteId]     = useState(null)
  const [search, setSearch]         = useState('')

  const load = () => {
    setLoading(true)
    getChargeCategories()
      .then(({ data }) => setCategories(data.results ?? data))
      .catch(() => toast.error('Failed to load charge categories'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('edit') }
  const openEdit = (c) => {
    setForm({ name: c.name, amount: c.amount, description: c.description ?? '', is_active: c.is_active })
    setEditId(c.id)
    setModal('edit')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) {
        await updateChargeCategory(editId, form)
        toast.success('Category updated')
      } else {
        await createChargeCategory(form)
        toast.success('Category created')
      }
      setModal(null)
      load()
    } catch (err) {
      const msg = err.response?.data?.detail
        || err.response?.data?.name?.[0]
        || (typeof err.response?.data === 'object' ? Object.values(err.response.data).flat()[0] : null)
        || 'Failed to save'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteChargeCategory(deleteId)
      toast.success('Category deleted')
      setDeleteId(null)
      load()
    } catch {
      toast.error('Failed to delete category')
    }
  }

  const filtered = categories.filter((c) => {
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q)
      || (c.description ?? '').toLowerCase().includes(q)
  })

  const activeCount = categories.filter(c => c.is_active).length

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Charge categories</h1>
          <p className="num text-[13px] text-ink-3 mt-1">
            {categories.length} categories, {activeCount} active
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={16} />
          Add category
        </button>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <input
          className="input"
          placeholder="Search categories…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search categories"
        />
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : filtered.length === 0 ? (
          search ? (
            <EmptyState
              message={`No categories match "${search}".`}
              action={<button className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>}
            />
          ) : (
            <EmptyState
              message="No charge categories yet."
              action={<button className="btn btn-primary" onClick={openAdd}>Add category</button>}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger min-w-[720px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Amount (Rs)</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th className="text-right">Charges</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td className="num text-right">{Number(c.amount).toLocaleString()}</td>
                    <td className="text-ink-2 max-w-xs truncate">{c.description || '—'}</td>
                    <td>
                      <Badge value={c.is_active ? 'active' : 'inactive'} label={c.is_active ? 'Active' : 'Inactive'} />
                    </td>
                    <td className="num text-right text-ink-2">{c.charges_count ?? 0}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="btn btn-ghost btn-sm">Edit</button>
                        <button onClick={() => setDeleteId(c.id)} className="btn btn-ghost btn-sm hover:!text-danger">Delete</button>
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
        title={editId ? 'Edit category' : 'Add category'} size="sm">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Name <span className="text-danger">*</span></label>
            <input className="input" placeholder="e.g. Books, Notebooks, Diary"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Amount (Rs) <span className="text-danger">*</span></label>
            <input className="input" type="number" min="0" step="any" placeholder="0"
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Optional description"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <input id="cc_active" type="checkbox" className="accent-[var(--accent)]"
              checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            <label htmlFor="cc_active" className="text-[13.5px] text-ink">Active</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? (<><Spinner /> Saving…</>) : editId ? 'Save changes' : 'Create category'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete category" size="sm">
        <p className="text-[14px] text-ink-2">
          Delete this charge category? Any existing charges using this category will not be affected.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDelete}>Delete category</button>
        </div>
      </Modal>
    </div>
  )
}
