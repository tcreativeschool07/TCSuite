'use client'

// Classes — CRUD + sync-from-students, logic verbatim from pages/fees/Classes.jsx.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  getClassRooms, createClassRoom, updateClassRoom,
  deleteClassRoom, syncClassRooms,
} from '@/src/api/feesApi'
import Modal from '@/src/components/Modal'
import Badge from '@/src/components/Badge'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

const EMPTY = { name: '', sort_order: 0, is_active: true }

export default function Classes() {
  const [classes, setClasses]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [editId, setEditId]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [syncing, setSyncing]   = useState(false)

  const load = () => {
    setLoading(true)
    getClassRooms()
      .then(({ data }) => setClasses(data.results ?? data))
      .catch(() => toast.error('Failed to load classes'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('edit') }
  const openEdit = (c) => {
    setForm({ name: c.name, sort_order: c.sort_order, is_active: c.is_active })
    setEditId(c.id)
    setModal('edit')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) {
        await updateClassRoom(editId, form)
        toast.success('Class updated')
      } else {
        await createClassRoom(form)
        toast.success('Class created')
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
      await deleteClassRoom(deleteId)
      toast.success('Class deleted')
      setDeleteId(null)
      load()
    } catch {
      toast.error('Failed to delete class')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { data } = await syncClassRooms()
      toast.success(`Synced: ${data.created} new classes added (${data.total} total)`)
      load()
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const totalStudents = classes.reduce((s, c) => s + (c.student_count || 0), 0)

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Classes</h1>
          <p className="num text-[13px] text-ink-3 mt-1">{classes.length} classes, {totalStudents} active students</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? (<><Spinner /> Syncing…</>) : 'Sync from students'}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} />
            Add class
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : classes.length === 0 ? (
          <EmptyState
            message="No classes yet."
            action={
              <>
                <button className="btn btn-secondary" onClick={handleSync}>Sync from students</button>
                <button className="btn btn-primary" onClick={openAdd}>Add class</button>
              </>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger min-w-[640px]">
              <thead>
                <tr>
                  <th>Class name</th>
                  <th className="text-right">Students</th>
                  <th className="text-right">Sort order</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td className="num text-right">
                      <Link href={`/students?current_class=${encodeURIComponent(c.name)}`}
                        className="text-accent hover:underline font-medium">
                        {c.student_count}
                      </Link>
                    </td>
                    <td className="num text-right text-ink-2">{c.sort_order}</td>
                    <td>
                      <Badge value={c.is_active ? 'active' : 'inactive'}
                        label={c.is_active ? 'Active' : 'Inactive'} />
                    </td>
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
        title={editId ? 'Edit class' : 'Add new class'} size="sm">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Class name <span className="text-danger">*</span></label>
            <input className="input" placeholder="e.g. One (A), PG, Ten (Boys)"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Sort order</label>
            <input className="input" type="number" min="0"
              value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} />
            <p className="text-[13px] text-ink-3 mt-1">Lower numbers appear first. Classes with the same order are sorted alphabetically.</p>
          </div>
          <div className="flex items-center gap-2">
            <input id="cls_active" type="checkbox" className="accent-[var(--accent)]"
              checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            <label htmlFor="cls_active" className="text-[13.5px] text-ink">Active</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? (<><Spinner /> Saving…</>) : editId ? 'Save changes' : 'Create class'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete class" size="sm">
        <p className="text-[14px] text-ink-2">
          Delete this class? This only removes the class entry — student records referencing this class name are not affected.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDelete}>Delete class</button>
        </div>
      </Modal>
    </div>
  )
}
