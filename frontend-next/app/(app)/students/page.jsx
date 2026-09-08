'use client'

// Students. Filter/search/pagination state logic, the by-class fetch,
// and the delete flow are ported verbatim from pages/students/Students.jsx.
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { getStudents, deleteStudent } from '@/src/api/studentsApi'
import Badge from '@/src/components/Badge'
import Modal from '@/src/components/Modal'
import useClassOptions from '@/src/hooks/useClassOptions'
import { Icon } from '@/src/components/icons'
import { TableSkeleton, EmptyState } from '@/src/components/Skeleton'

import client from '@/src/api/client'
// PARITY: kept as an ad-hoc call exactly as in the old page (not in studentsApi.js).
const getStudentsByClass = (params) => client.get('/students/by-class/', { params })

const rs = (v) => `Rs ${Number(v).toLocaleString()}`

// ── List view ─────────────────────────────────────────────
function ListView({ onDelete, reloadKey }) {
  const router = useRouter()
  const [data, setData]           = useState([])
  const [count, setCount]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [classFilter, setClass]   = useState('')
  const [withdrawn, setWithdrawn] = useState('')
  const [page, setPage]           = useState(1)
  const classOptions = useClassOptions()
  const PAGE_SIZE = 20

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, page_size: PAGE_SIZE }
    if (search)      params.search        = search
    if (classFilter) params.current_class = classFilter
    if (withdrawn)   params.withdrawn     = withdrawn
    getStudents(params)
      .then(({ data: res }) => {
        setData(res.results ?? res)
        setCount(res.count ?? (res.results ?? res).length)
      })
      .catch(() => toast.error('Failed to load students'))
      .finally(() => setLoading(false))
  }, [page, search, classFilter, withdrawn])

  useEffect(() => { load() }, [load, reloadKey])

  const totalPages = Math.ceil(count / PAGE_SIZE)
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, count)
  const hasFilters = search || classFilter || withdrawn

  return (
    <>
      {/* Filters */}
      <div className="panel p-4 flex flex-col sm:flex-row gap-3">
        <input
          className="input flex-1"
          placeholder="Search by name, admission no., B-Form, guardian…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
        <select className="input w-full sm:w-48" value={classFilter}
          onChange={(e) => { setClass(e.target.value); setPage(1) }}>
          <option value="">All classes</option>
          {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input w-full sm:w-44" value={withdrawn}
          onChange={(e) => { setWithdrawn(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="no">Active</option>
          <option value="yes">Withdrawn</option>
        </select>
        {hasFilters && (
          <button className="btn btn-secondary"
            onClick={() => { setSearch(''); setClass(''); setWithdrawn(''); setPage(1) }}>
            Clear
          </button>
        )}
      </div>

      {/* Table — skeleton only on first load; refetches keep the rows on
          screen (slightly dimmed) so filter/pagination changes feel instant */}
      <div className="panel overflow-hidden">
        {loading && data.length === 0 ? (
          <TableSkeleton rows={8} cols={8} />
        ) : data.length === 0 ? (
          <EmptyState
            message={hasFilters ? 'No students match these filters.' : 'No students enrolled yet.'}
            action={hasFilters
              ? <button className="btn btn-secondary" onClick={() => { setSearch(''); setClass(''); setWithdrawn(''); setPage(1) }}>Clear filters</button>
              : <Link href="/students/new" className="btn btn-primary">Enrol student</Link>}
          />
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity duration-120 ${loading ? 'opacity-60' : ''}`}>
              <table className="ledger min-w-[850px]">
                <thead>
                  <tr>
                    <th>Admission no.</th>
                    <th>Name</th>
                    <th>Class</th>
                    <th className="text-right">Monthly fee</th>
                    <th>Guardian</th>
                    <th>Contact</th>
                    <th className="text-right">Arrears</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => (
                    <tr key={s.id}>
                      <td className="num text-accent font-medium">{s.admission_no}</td>
                      <td className="font-medium">
                        <Link href={`/students/${s.id}`} className="hover:text-accent">{s.student_name}</Link>
                      </td>
                      <td>{s.current_class}</td>
                      <td className="num text-right">
                        {s.current_fee ? rs(s.current_fee) : <span className="text-ink-3">—</span>}
                      </td>
                      <td>{s.f_g_name}</td>
                      <td className="num">{s.f_g_contact}</td>
                      <td className="num text-right">
                        {Number(s.arrear_dues) > 0
                          ? <span className="text-danger font-medium">{rs(s.arrear_dues)}</span>
                          : <span className="text-ink-3">—</span>}
                      </td>
                      <td>
                        <Badge value={s.withdrawn} label={s.withdrawn === 'yes' ? 'Withdrawn' : 'Active'} />
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => router.push(`/students/${s.id}`)}
                            className="btn btn-ghost btn-sm px-2" aria-label={`View ${s.student_name}`} title="View">
                            <Icon name="eye" size={16} />
                          </button>
                          <button onClick={() => router.push(`/students/${s.id}/edit`)}
                            className="btn btn-ghost btn-sm px-2" aria-label={`Edit ${s.student_name}`} title="Edit">
                            <Icon name="pencil" size={16} />
                          </button>
                          <button onClick={() => onDelete(s.id)}
                            className="btn btn-ghost btn-sm px-2 hover:!text-danger" aria-label={`Delete ${s.student_name}`} title="Delete">
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-rule px-4 py-3">
                <p className="num text-[13px] text-ink-2">Showing {from}–{to} of {count}</p>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn btn-secondary btn-sm">Previous</button>
                  <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="btn btn-secondary btn-sm">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Class view ────────────────────────────────────────────
function ClassView() {
  const router = useRouter()
  const [groups, setGroups]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    getStudentsByClass()
      .then(({ data }) => {
        setGroups(data)
        const first = data.find(g => g.count > 0)
        if (first) setExpanded({ [first.class_name]: true })
      })
      .catch(() => toast.error('Failed to load class groups'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (cls) => setExpanded((prev) => ({ ...prev, [cls]: !prev[cls] }))

  const totalStudents = groups.reduce((s, g) => s + g.count, 0)

  if (loading) {
    return <div className="panel overflow-hidden"><TableSkeleton rows={6} cols={5} /></div>
  }

  if (groups.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          message="No classes found."
          action={<Link href="/classes" className="btn btn-secondary">Go to classes</Link>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        <span className="font-medium text-ink">{groups.length}</span> classes ·{' '}
        <span className="num font-medium text-ink">{totalStudents}</span> active students
      </p>

      {groups.map((g) => (
        <div key={g.class_name} className="panel overflow-hidden">
          {/* Class header */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface-sunken transition-colors duration-120"
            onClick={() => toggle(g.class_name)}
            aria-expanded={!!expanded[g.class_name]}
          >
            <div className="text-left">
              <p className="font-semibold text-ink">{g.class_name}</p>
              <p className="text-[13px] text-ink-3">
                {g.count > 0
                  ? `${g.count} active student${g.count !== 1 ? 's' : ''}`
                  : 'No students'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {g.count > 0 && (
                <Link
                  href={`/fees/records?current_class=${encodeURIComponent(g.class_name)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[13px] text-accent hover:underline"
                >
                  View fee records
                </Link>
              )}
              <Icon
                name="chevronDown"
                size={18}
                className={`text-ink-3 transition-transform duration-120 ${expanded[g.class_name] ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* Students table */}
          {expanded[g.class_name] && (
            <div className="border-t border-rule overflow-x-auto">
              {g.count === 0 ? (
                <EmptyState message="No active students in this class." />
              ) : (
                <table className="ledger min-w-[680px]">
                  <thead>
                    <tr>
                      <th>Admission no.</th>
                      <th>Name</th>
                      <th className="text-right">Monthly fee</th>
                      <th>Guardian</th>
                      <th>Contact</th>
                      <th className="text-right">Arrears</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.students.map((s) => (
                      <tr key={s.id}>
                        <td className="num text-accent text-[13px]">{s.admission_no}</td>
                        <td className="font-medium">{s.student_name}</td>
                        <td className="num text-right text-[13px]">
                          {s.current_fee ? rs(s.current_fee) : <span className="text-ink-3">—</span>}
                        </td>
                        <td>{s.f_g_name}</td>
                        <td className="num">{s.f_g_contact}</td>
                        <td className="num text-right text-[13px]">
                          {Number(s.arrear_dues) > 0
                            ? <span className="text-danger font-medium">{rs(s.arrear_dues)}</span>
                            : <span className="text-ink-3">—</span>}
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => router.push(`/students/${s.id}`)}
                              className="btn btn-ghost btn-sm">View</button>
                            <button onClick={() => router.push(`/students/${s.id}/edit`)}
                              className="btn btn-ghost btn-sm">Edit</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main Students page ────────────────────────────────────
export default function Students() {
  const [tab, setTab]           = useState('list')
  const [deleteId, setDeleteId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const handleDeleteConfirm = async () => {
    try {
      await deleteStudent(deleteId)
      toast.success('Student deleted')
      setDeleteId(null)
      setReloadKey(k => k + 1)
    } catch {
      toast.error('Could not delete student')
    }
  }

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="page-title">Students</h1>
        <Link href="/students/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          Enrol student
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border border-edge bg-surface p-1 rounded-control w-fit" role="tablist">
        {[
          { key: 'list',  label: 'All students' },
          { key: 'class', label: 'By class' },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 h-8 rounded-[4px] text-[13px] font-medium transition-colors duration-120 ${
              tab === t.key
                ? 'bg-accent-tint text-accent'
                : 'text-ink-2 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list'
        ? <ListView onDelete={setDeleteId} reloadKey={reloadKey} />
        : <ClassView />
      }

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete student" size="sm">
        <p className="text-[14px] text-ink-2">
          Permanently delete this student? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDeleteConfirm}>Delete student</button>
        </div>
      </Modal>
    </div>
  )
}
