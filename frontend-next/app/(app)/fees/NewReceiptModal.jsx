'use client'

// Build a receipt by hand for one student.
//
// Find the student, see everything they still owe broken into pickable lines
// (arrears they enrolled with, each month's unpaid fee, each month's unpaid
// charges), tick the ones this receipt is for, adjust amounts if the office is
// asking for part of a due, set a due date, and print.
//
// The receipt number is issued by the server and is not editable — the preview
// shown while composing is the next number in the run; the number actually
// stamped on the document is allocated when it is saved, so abandoning this
// dialog doesn't burn one out of the sequence.
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import Modal from '@/src/components/Modal'
import { Icon, Spinner } from '@/src/components/icons'
import { getStudents } from '@/src/api/studentsApi'
import {
  getNextReceiptNumber,
  getStudentDues,
  createCustomReceipt,
  downloadCustomReceiptPdf,
} from '@/src/api/feesApi'

const rs = (v) => `Rs ${Number(v || 0).toLocaleString()}`
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const KIND_LABEL = {
  arrear: 'Brought forward',
  fee:    'Monthly fee',
  misc:   'Charges',
}

export default function NewReceiptModal({ open, onClose }) {
  const [receiptNo, setReceiptNo] = useState('')
  const [search, setSearch]       = useState('')
  const [results, setResults]     = useState([])
  const [searching, setSearching] = useState(false)
  const [student, setStudent]     = useState(null)
  const [dues, setDues]           = useState([])
  const [duesLoading, setDuesLoading] = useState(false)
  const [dueDate, setDueDate]     = useState('')
  const [remarks, setRemarks]     = useState('')
  const [saving, setSaving]       = useState(false)

  // Fresh dialog every time it opens, with the next number previewed.
  useEffect(() => {
    if (!open) return
    setSearch(''); setResults([]); setStudent(null); setDues([])
    setDueDate(''); setRemarks(''); setReceiptNo('')
    getNextReceiptNumber()
      .then(({ data }) => setReceiptNo(data.receipt_display))
      .catch(() => setReceiptNo(''))
  }, [open])

  // Debounced student lookup — by name or admission number, the same search
  // the students list uses.
  useEffect(() => {
    if (!open || student) return
    const q = search.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      getStudents({ search: q })
        .then(({ data }) => setResults((data.results ?? data).slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [search, open, student])

  const pickStudent = (s) => {
    setStudent(s)
    setResults([])
    setDuesLoading(true)
    getStudentDues({ student: s.id })
      // `outstanding` is kept beside the editable `amount` so the column
      // showing what is owed doesn't move while the amount is being typed in.
      .then(({ data }) => setDues(
        (data.items ?? []).map(i => ({
          ...i, include: true, outstanding: i.amount, amount: String(i.amount),
        }))
      ))
      .catch(() => toast.error('Failed to load this student’s dues'))
      .finally(() => setDuesLoading(false))
  }

  const clearStudent = () => {
    setStudent(null); setDues([]); setSearch(''); setResults([])
  }

  const update = (key, patch) =>
    setDues(prev => prev.map(d => (d.key === key ? { ...d, ...patch } : d)))

  const selected = dues.filter(d => d.include && num(d.amount) > 0)
  const total = selected.reduce((sum, d) => sum + num(d.amount), 0)

  const handleGenerate = async () => {
    if (!student) { toast.error('Select a student first'); return }
    if (total <= 0) { toast.error('Select at least one due to bill'); return }
    setSaving(true)
    try {
      const { data } = await createCustomReceipt({
        student: student.id,
        due_date: dueDate || null,
        remarks,
        items: selected.map(({ key, kind, label, record, month, year, amount }) => ({
          key, kind, label, record, month, year, amount: num(amount),
        })),
      })
      const { data: blob } = await downloadCustomReceiptPdf(data.id)
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Receipt_${data.receipt_no}_${student.student_name}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Receipt ${data.receipt_display} issued`)
      onClose()
    } catch (err) {
      const d = err.response?.data
      const msg = d?.items?.[0] || d?.detail || d?.non_field_errors?.[0]
        || 'Failed to generate the receipt'
      toast.error(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New receipt" size="lg">
      <div className="space-y-4">
        {/* Receipt number — issued by the system, never typed */}
        <div className="rounded-control bg-surface-sunken p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] text-ink-3">Receipt number</p>
            <p className="num text-[18px] font-semibold text-ink leading-tight">
              {receiptNo || <Spinner />}
            </p>
          </div>
          <p className="text-[12.5px] text-ink-3 max-w-[300px]">
            Issued automatically and never reused. The final number is stamped
            when you generate.
          </p>
        </div>

        {/* Student */}
        {!student ? (
          <div>
            <label className="label" htmlFor="nr-student">Find the student</label>
            <input
              id="nr-student"
              className="input"
              placeholder="Search by name or admission number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            {searching && (
              <p className="text-[13px] text-ink-3 mt-2 flex items-center gap-2">
                <Spinner /> Searching…
              </p>
            )}
            {!searching && results.length > 0 && (
              <ul className="mt-2 border border-edge rounded-control divide-y divide-rule max-h-60 overflow-y-auto">
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => pickStudent(s)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-sunken transition-colors duration-120"
                    >
                      <span className="font-medium text-ink block leading-tight">
                        {s.student_name}
                      </span>
                      <span className="num text-[12px] text-ink-3">
                        #{s.admission_no} · {s.current_class || 'No class'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && search.trim().length >= 2 && results.length === 0 && (
              <p className="text-[13px] text-ink-3 mt-2">No students match that search.</p>
            )}
          </div>
        ) : (
          <div className="rounded-control border border-edge p-4 flex flex-wrap items-start justify-between gap-3">
            <div className="text-[13.5px] space-y-0.5">
              <p className="font-semibold text-ink text-[15px]">{student.student_name}</p>
              <p className="num text-ink-3 text-[12.5px]">
                #{student.admission_no} · {student.current_class || 'No class'}
              </p>
              <p className="text-ink-2">
                {student.f_g_name}
                {student.f_g_contact && <span className="num text-ink-3"> · {student.f_g_contact}</span>}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearStudent}>
              Change student
            </button>
          </div>
        )}

        {/* Dues */}
        {student && (
          duesLoading ? (
            <p className="text-[13px] text-ink-3 flex items-center gap-2">
              <Spinner /> Loading outstanding dues…
            </p>
          ) : dues.length === 0 ? (
            <div className="rounded-control bg-surface-sunken p-4 text-[13.5px] text-ink-2">
              This student has nothing outstanding — there is nothing to bill on a receipt.
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="label mb-0">What this receipt is for</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDues(prev => prev.map(d => ({ ...d, include: true })))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDues(prev => prev.map(d => ({ ...d, include: false })))}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="ledger min-w-[520px]">
                  <thead>
                    <tr>
                      <th className="w-10"><span className="sr-only">Include</span></th>
                      <th>Due</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-right w-36">Billing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.map((d) => (
                      <tr key={d.key} className={d.include ? '' : 'opacity-55'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={d.include}
                            onChange={(e) => update(d.key, { include: e.target.checked })}
                            aria-label={`Include ${d.label}`}
                          />
                        </td>
                        <td>
                          <span className="font-medium block leading-tight">{d.label}</span>
                          <span className="text-[12px] text-ink-3">{KIND_LABEL[d.kind] ?? d.kind}</span>
                        </td>
                        <td className="num text-right text-danger">{rs(d.outstanding)}</td>
                        <td className="text-right">
                          <input
                            className="input text-right w-32 ml-auto"
                            type="number"
                            min="0"
                            step="1"
                            value={d.amount}
                            disabled={!d.include}
                            onChange={(e) => update(d.key, { amount: e.target.value })}
                            aria-label={`Amount for ${d.label}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12.5px] text-ink-3 mt-2">
                Amounts default to what is outstanding. Lower one to ask for part of a due.
                This receipt is a demand — it does not record a payment or change the ledger.
              </p>
            </div>
          )
        )}

        {/* Due date + remarks */}
        {student && dues.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label" htmlFor="nr-due">Due date for this receipt</label>
              <input
                id="nr-due"
                type="date"
                className="input w-48"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label" htmlFor="nr-remarks">Remarks (optional)</label>
              <input
                id="nr-remarks"
                className="input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Shown on the office copy only"
              />
            </div>
          </div>
        )}

        {/* Total + actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-rule">
          <p className="text-[13.5px] pt-3">
            <span className="text-ink-2">Total payable:</span>{' '}
            <strong className="num text-ink text-[16px]">{rs(total)}</strong>
            {selected.length > 0 && (
              <span className="text-ink-3"> · {selected.length} item{selected.length > 1 ? 's' : ''}</span>
            )}
          </p>
          <div className="flex gap-3 pt-3">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={saving || total <= 0}
            >
              {saving
                ? (<><Spinner /> Generating…</>)
                : (<><Icon name="printer" size={16} stroke={1.75} /> Generate receipt</>)}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
