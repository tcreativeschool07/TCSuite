'use client'

// PARITY: working print document — ported near-verbatim from
// pages/fees/InvoiceClass.jsx. Allowed changes only: brand color
// #1d4ed8 → #1E5C48, serif stack added to the school name, router hooks
// swapped to next/navigation (useSearchParams wrapped in Suspense as Next
// requires). A4 landscape, 10mm margins, the 700ms auto-print timing and the
// StrictMode-safe printed ref are all unchanged.
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import client from '@/src/api/client'
import { Spinner } from '@/src/components/icons'

const MONTHS = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function InvoiceClassInner() {
  const sp = useSearchParams()
  const className = sp.get('class')
  const month     = Number(sp.get('month'))
  const year      = sp.get('year')

  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const printed = useRef(false)
  const generated = useGeneratedStamp(!!data)

  useEffect(() => {
    if (!className || !month || !year) {
      setError('Missing parameters: class, month, year required.')
      return
    }
    client.get('/fees/records/class-invoice/', {
      params: { current_class: className, month, year },
    })
      .then(({ data: res }) => setData(res))
      .catch(() => setError('Could not load class invoice'))
  }, [className, month, year])

  useEffect(() => {
    if (data && !printed.current) {
      printed.current = true
      setTimeout(() => window.print(), 700)
    }
  }, [data])

  if (error) return <div style={{ padding: 32, color: '#A23B32' }}>{error}</div>
  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8 text-[#1E5C48]" />
      </div>
    )
  }

  const { records, summary } = data
  const monthName = MONTHS[month] ?? month

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; }
        .page { background: white; max-width: 1100px; margin: 20px auto; padding: 28px 36px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
        .header { text-align: center; border-bottom: 2px solid #1E5C48; padding-bottom: 14px; margin-bottom: 20px; }
        .school-name { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #1E5C48; }
        .school-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .sheet-title { font-size: 15px; font-weight: 700; color: #1f2937; }
        .sheet-meta { font-size: 12px; color: #6b7280; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #1E5C48; color: white; padding: 7px 10px; text-align: left; font-weight: 600; }
        td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; }
        tr:nth-child(even) td { background: #f9fafb; }
        .mono { font-family: monospace; }
        .status-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }
        .status-paid    { background: #dcfce7; color: #166534; }
        .status-partial { background: #fef9c3; color: #854d0e; }
        .status-unpaid  { background: #fee2e2; color: #991b1b; }
        .status-waived  { background: #f3f4f6; color: #4b5563; }
        .summary-row td { background: #E6F0EB; font-weight: 700; font-size: 13px; border-top: 2px solid #1E5C48; }
        .footer { margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
        .sig-box { text-align: center; }
        .sig-line { border-top: 1px solid #9ca3af; width: 140px; margin: 0 auto 4px; margin-top: 32px; }
      `}</style>

      <div className="no-print" style={{ textAlign: 'center', padding: '16px 0' }}>
        <button
          onClick={() => window.print()}
          style={{
            background: '#1E5C48', color: 'white', padding: '8px 24px',
            borderRadius: 8, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
          }}
        >
          Print collection sheet
        </button>
      </div>

      <div className="page">
        <div className="header">
          <div className="school-name">The Creative School</div>
          <div className="school-sub">Monthly Fee Collection Sheet</div>
        </div>

        <div className="title-row">
          <div>
            <div className="sheet-title">Class: {className} — {monthName} {year}</div>
            <div className="sheet-meta">Total Students with Records: {data.total_students}</div>
          </div>
          <div className="sheet-meta" style={{ textAlign: 'right' }}>
            Generated: {new Date().toLocaleDateString()}<br />
            Collected: Rs {Number(summary.total_collected ?? 0).toLocaleString()} &nbsp;|&nbsp;
            Balance: Rs {Number(summary.total_balance ?? 0).toLocaleString()}
          </div>
        </div>

        {records.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>
            No fee records found for {className} in {monthName} {year}.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Receipt No</th>
                <th>Adm #</th>
                <th>Student Name</th>
                <th>Father / Guardian</th>
                <th>Contact</th>
                <th>Prev. Balance</th>
                <th>Monthly Fee</th>
                <th>Total Due</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td className="mono">{r.receipt_no}</td>
                  <td className="mono">{r.student.admission_no}</td>
                  <td style={{ fontWeight: 600 }}>{r.student.student_name}</td>
                  <td>{r.student.f_g_name}</td>
                  <td>{r.student.f_g_contact}</td>
                  <td className="mono">Rs {Number(r.previous_balance).toLocaleString()}</td>
                  <td className="mono">Rs {Number(r.current_fee).toLocaleString()}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>Rs {Number(r.total_amount).toLocaleString()}</td>
                  <td className="mono" style={{ color: '#16a34a' }}>Rs {Number(r.amount_paid).toLocaleString()}</td>
                  <td className="mono" style={{ color: Number(r.balance) > 0 ? '#dc2626' : 'inherit' }}>
                    Rs {Number(r.balance).toLocaleString()}
                  </td>
                  <td>
                    <span className={`status-badge status-${r.status}`}>{r.status.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
              {/* Summary row */}
              <tr className="summary-row">
                <td colSpan={6} style={{ textAlign: 'right' }}>TOTALS</td>
                <td className="mono">—</td>
                <td className="mono">—</td>
                <td className="mono">Rs {Number(summary.total_due ?? 0).toLocaleString()}</td>
                <td className="mono" style={{ color: '#16a34a' }}>Rs {Number(summary.total_collected ?? 0).toLocaleString()}</td>
                <td className="mono" style={{ color: '#dc2626' }}>Rs {Number(summary.total_balance ?? 0).toLocaleString()}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="footer">
          <div className="sig-box">
            <div className="sig-line" />
            Accounts Officer
          </div>
          <div style={{ color: '#9ca3af', alignSelf: 'flex-end', fontSize: 10, textAlign: 'center' }}>
            The Creative School — Fee Collection Sheet
            <br />Generated {generated}
          </div>
          <div className="sig-box">
            <div className="sig-line" />
            Principal
          </div>
        </div>
      </div>
    </>
  )
}

// When this sheet was produced, captured once when the data lands rather than
// on every render, so the printed copy and the screen agree. The browser's own
// locale/zone is the right one here — it is the office machine doing the print.
function useGeneratedStamp(ready) {
  const [stamp, setStamp] = useState('')
  useEffect(() => {
    if (ready && !stamp) {
      setStamp(new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }))
    }
  }, [ready, stamp])
  return stamp
}

export default function InvoiceClassPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8 text-[#1E5C48]" />
      </div>
    }>
      <InvoiceClassInner />
    </Suspense>
  )
}
