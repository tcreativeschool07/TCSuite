'use client'

// Student detail. Data loading, id validation, delete flow, PDF
// download, and the year-tab fee-history logic are verbatim from
// pages/students/StudentDetail.jsx. Restyle only: definition-row info panels,
// signature ledger table, flagged rows instead of tinted rows + pulsing dots.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { getStudent, deleteStudent } from '@/src/api/studentsApi'
import { getStudentFeeHistory, downloadStudentInvoicePdf } from '@/src/api/feesApi'
import Badge from '@/src/components/Badge'
import Modal from '@/src/components/Modal'
import { Skeleton, EmptyState } from '@/src/components/Skeleton'

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-ink">{value || <span className="text-ink-3">—</span>}</dd>
    </div>
  )
}

// PARITY: local status map kept from the old page (includes the extra
// no_record state used only by this month-by-month table). Badge classes only.
const STATUS_BADGE = {
  paid:      'badge-ok',
  partial:   'badge-warn',
  unpaid:    'badge-danger',
  advance:   'badge-info',
  waived:    'badge-neutral',
  no_record: 'badge-neutral opacity-50',
}

export default function StudentDetail() {
  const params = useParams()
  const id = params?.id
  const router = useRouter()
  const [student, setStudent]       = useState(null)
  const [feeHistory, setFeeHistory] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [showDelete, setShowDelete] = useState(false)
  const [activeYear, setActiveYear] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(null)

  useEffect(() => {
    if (!id || isNaN(Number(id))) {
      toast.error('Invalid student ID')
      router.replace('/students')
      return
    }
    Promise.all([
      getStudent(id),
      getStudentFeeHistory({ student: id }),
    ])
      .then(([sRes, fRes]) => {
        setStudent(sRes.data)
        setFeeHistory(fRes.data)
        if (fRes.data.years?.length) {
          setActiveYear(fRes.data.years[0].year)
        }
      })
      .catch(() => toast.error('Failed to load student'))
      .finally(() => setLoading(false))
  }, [id, router])

  const handleDelete = async () => {
    try {
      await deleteStudent(id)
      toast.success('Student deleted')
      router.push('/students')
    } catch {
      toast.error('Could not delete student')
    }
  }

  const handleDownloadPdf = async (recordId) => {
    setPdfLoading(recordId)
    try {
      const { data: blob } = await downloadStudentInvoicePdf(recordId)
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Invoice_${recordId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download PDF')
    } finally {
      setPdfLoading(null)
    }
  }

  const fmt = (v) => `Rs ${Number(v || 0).toLocaleString()}`

  if (loading) {
    return (
      <div className="max-w-content mx-auto px-6 py-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="panel p-5 space-y-4">
            <Skeleton className="h-5 w-44" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4" />)}
          </div>
          <div className="panel p-5 space-y-4">
            <Skeleton className="h-5 w-44" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4" />)}
          </div>
        </div>
        <div className="panel p-5 space-y-3">
          <Skeleton className="h-5 w-52" />
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}
        </div>
      </div>
    )
  }

  if (!student) {
    return (
      <div className="max-w-content mx-auto px-6 py-6">
        <div className="panel">
          <EmptyState
            message="Couldn't load this student. Check that the server is running, then retry."
            action={<Link href="/students" className="btn btn-secondary">Back to students</Link>}
          />
        </div>
      </div>
    )
  }

  const activeYearData = feeHistory?.years?.find(y => y.year === activeYear)

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <nav className="text-[13px] text-ink-3 mb-1" aria-label="Breadcrumb">
            <Link href="/students" className="hover:text-accent">Students</Link>
            <span className="mx-2">/</span>
            <span className="text-ink-2">{student.student_name}</span>
          </nav>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="page-title">{student.student_name}</h1>
            <span className="num text-[14px] text-ink-3">#{student.admission_no}</span>
            <Badge value={student.withdrawn} label={student.withdrawn === 'yes' ? 'Withdrawn' : 'Active'} />
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/students/${id}/edit`} className="btn btn-secondary">Edit</Link>
          <button className="btn btn-danger" onClick={() => setShowDelete(true)}>Delete</button>
        </div>
      </div>

      {/* Student info panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="panel p-5">
          <h2 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">Personal information</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Full name"       value={student.student_name} />
            <Field label="B-Form / CNIC"   value={student.b_form} />
            <Field label="Date of birth"   value={student.dob} />
            <Field label="Religion"        value={student.religion} />
            <Field label="Tribe / caste"   value={student.tribe_caste} />
            <Field label="Address"         value={student.address} />
            <Field label="Email"           value={student.email} />
          </dl>
        </div>

        <div className="space-y-5">
          <div className="panel p-5">
            <h2 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">Guardian / father</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Name"       value={student.f_g_name} />
              <Field label="CNIC"       value={student.f_g_cnic} />
              <Field label="Occupation" value={student.f_g_occupation} />
              <Field label="Contact"    value={student.f_g_contact} />
            </dl>
          </div>

          <div className="panel p-5">
            <h2 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">Academic</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Admission class"    value={student.class_of_admission} />
              <Field label="Current class"      value={student.current_class} />
              <Field label="Date of admission"  value={student.date_of_admission} />
              <div>
                <dt className="text-[13px] font-medium text-ink-3">Status</dt>
                <dd className="mt-1">
                  <Badge value={student.withdrawn} label={student.withdrawn === 'yes' ? 'Withdrawn' : 'Active'} />
                </dd>
              </div>
              {student.withdrawn === 'yes' && (
                <Field label="Class of withdrawal" value={student.class_of_withdrawl} />
              )}
              <Field label="Monthly fee"
                value={student.current_fee ? `Rs ${Number(student.current_fee).toLocaleString()}` : '— (class structure)'} />
              <Field label="Arrear dues" value={Number(student.arrear_dues) > 0 ? `Rs ${Number(student.arrear_dues).toLocaleString()}` : '0'} />
            </dl>
            {student.remarks && (
              <div className="mt-4 pt-3 border-t border-rule">
                <dt className="text-[13px] font-medium text-ink-3">Remarks</dt>
                <dd className="mt-1 text-[14px] text-ink-2">{student.remarks}</dd>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lifetime fee summary */}
      {feeHistory?.lifetime && (
        <div className="panel p-5">
          <h2 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">Lifetime fee summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[13px] text-ink-2">Total records</p>
              <p className="num text-[22px] font-semibold text-ink mt-0.5">{feeHistory.lifetime.total_records}</p>
            </div>
            <div>
              <p className="text-[13px] text-ink-2">Total fee</p>
              <p className="num text-[22px] font-semibold text-ink mt-0.5">{fmt(feeHistory.lifetime.total_fee)}</p>
            </div>
            <div>
              <p className="text-[13px] text-ink-2">Total paid</p>
              <p className="num text-[22px] font-semibold text-ok mt-0.5">{fmt(feeHistory.lifetime.total_paid)}</p>
            </div>
            <div>
              <p className="text-[13px] text-ink-2">Outstanding</p>
              <p className={`num text-[22px] font-semibold mt-0.5 ${feeHistory.lifetime.total_balance > 0 ? 'text-danger' : 'text-ink-3'}`}>
                {fmt(feeHistory.lifetime.total_balance)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Year-by-year fee history */}
      <div className="panel overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-rule flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">Fee history — year by year</h2>
            <p className="text-[13px] text-ink-3">Every month of every year is stored permanently.</p>
          </div>
          <Link href={`/fees/records?student=${id}`} className="text-[13px] font-medium text-accent hover:underline">
            View all records
          </Link>
        </div>

        {(!feeHistory?.years || feeHistory.years.length === 0) ? (
          <EmptyState message="No fee records found for this student." />
        ) : (
          <>
            {/* Year tabs */}
            <div className="px-5 pt-4 flex flex-wrap gap-2">
              {feeHistory.years.map(yd => (
                <button
                  key={yd.year}
                  onClick={() => setActiveYear(yd.year)}
                  className={`btn btn-sm ${activeYear === yd.year ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <span className="num">{yd.year}</span>
                  <span className="num text-[11px] opacity-75">({yd.records_count})</span>
                </button>
              ))}
            </div>

            {/* Year summary */}
            {activeYearData && (
              <div className="px-5 py-3">
                <div className="rounded-control bg-surface-sunken px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                  <span className="text-ink-2">
                    Year <strong className="num text-ink">{activeYearData.year}</strong>
                  </span>
                  <span className="text-ink-2">
                    Records <strong className="num text-ink">{activeYearData.records_count}/12</strong>
                  </span>
                  <span className="text-ink-2">
                    Fee <strong className="num text-ink">{fmt(activeYearData.total_fee)}</strong>
                  </span>
                  <span className="text-ok">
                    Paid <strong className="num">{fmt(activeYearData.total_paid)}</strong>
                  </span>
                  {activeYearData.total_balance > 0 && (
                    <span className="text-danger">
                      Balance <strong className="num">{fmt(activeYearData.total_balance)}</strong>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Month-by-month table */}
            {activeYearData && (
              <div className="overflow-x-auto">
                <table className="ledger min-w-[860px]">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Status</th>
                      <th className="text-right">Prev balance</th>
                      <th className="text-right">Fee</th>
                      <th className="text-right">Total due</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Balance</th>
                      <th>Receipt</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeYearData.months.map(m => {
                      const hasRecord = m.status !== 'no_record'
                      const isDefaulter = m.status === 'unpaid' || m.status === 'partial'
                      const isAdvance = m.status === 'advance'
                      return (
                        <tr key={m.month} className={isDefaulter ? 'row-flag' : isAdvance ? 'row-info' : ''}>
                          <td className="font-medium">{m.month_name}</td>
                          <td>
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`badge ${STATUS_BADGE[m.status] || STATUS_BADGE.no_record}`}>
                                {hasRecord && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />}
                                {hasRecord ? m.status : '—'}
                              </span>
                              {m.is_late && (
                                <span className="badge badge-warn" title={m.late_paid_on ? `Paid late on ${m.late_paid_on}` : 'Paid after the month ended'}>
                                  Late
                                </span>
                              )}
                            </span>
                          </td>
                          {hasRecord ? (
                            <>
                              <td className="num text-right text-[13px]">
                                {m.previous_balance > 0
                                  ? <span className="text-warn">{fmt(m.previous_balance)}</span>
                                  : <span className="text-ink-3">0</span>}
                              </td>
                              <td className="num text-right text-[13px]">{fmt(m.current_fee)}</td>
                              <td className="num text-right text-[13px] font-medium">{fmt(m.total_amount)}</td>
                              <td className="num text-right text-[13px] text-ok">{fmt(m.amount_paid)}</td>
                              <td className="num text-right text-[13px]">
                                {m.balance > 0
                                  ? <span className="text-danger font-semibold">{fmt(m.balance)}</span>
                                  : <span className="text-ink-3">0</span>}
                              </td>
                              <td className="num text-[13px] text-accent">{m.receipt_no}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleDownloadPdf(m.id)}
                                    disabled={pdfLoading === m.id}
                                  >
                                    {pdfLoading === m.id ? '…' : 'PDF'}
                                  </button>
                                  <a
                                    href={`/fees/invoice/${m.id}`}
                                    target="_blank"
                                    rel="noopener"
                                    className="btn btn-ghost btn-sm"
                                  >
                                    Print
                                  </a>
                                </div>
                              </td>
                            </>
                          ) : (
                            <td colSpan={7} className="text-center text-[13px] text-ink-3 italic">
                              No record
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                  {/* Year totals */}
                  <tfoot>
                    <tr>
                      <td>Total ({activeYearData.year})</td>
                      <td className="text-ink-2">{activeYearData.records_count} months</td>
                      <td className="num text-right">
                        {fmt(activeYearData.months.filter(m => m.status !== 'no_record').reduce((s, m) => s + (m.previous_balance || 0), 0))}
                      </td>
                      <td className="num text-right">{fmt(activeYearData.total_fee)}</td>
                      <td className="num text-right">
                        {fmt(activeYearData.months.filter(m => m.status !== 'no_record').reduce((s, m) => s + (m.total_amount || 0), 0))}
                      </td>
                      <td className="num text-right text-ok">{fmt(activeYearData.total_paid)}</td>
                      <td className="num text-right text-danger">{fmt(activeYearData.total_balance)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete modal */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete student" size="sm">
        <p className="text-[14px] text-ink-2">
          Permanently delete <strong className="text-ink">{student.student_name}</strong>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-secondary" onClick={() => setShowDelete(false)}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={handleDelete}>Delete student</button>
        </div>
      </Modal>
    </div>
  )
}
