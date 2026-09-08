'use client'

// PARITY: working print document — ported near-verbatim from
// pages/fees/InvoiceStudent.jsx. Allowed changes only: brand color
// #1d4ed8 → #1E5C48, serif stack added to the school name, router hooks
// swapped to next/navigation. A5 size, 12mm margins, .no-print, the 600ms
// auto-print timing and the StrictMode-safe printed ref are all unchanged.
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import client from '@/src/api/client'
import { Spinner } from '@/src/components/icons'

const MONTHS = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const num = (v) => Number(v || 0)

// The arrears on a receipt, split into the months they are owed for. Mirrors
// _arrear_rows() in fees/pdf.py, including the reconciliation against
// previous_balance so the printed rows always add up to the total.
function buildArrearLines(record) {
  const prev = num(record.previous_balance)
  if (prev <= 0) return []

  const ar = record.arrears || {}
  const lines = []
  let listed = 0

  const legacy = num(ar.legacy)
  if (legacy > 0) {
    lines.push({ key: 'legacy', label: 'Arrears Brought Forward', amount: legacy })
    listed += legacy
  }

  for (const p of ar.periods || []) {
    const amount = num(p.outstanding)
    if (amount <= 0) continue
    lines.push({ key: `p${p.id}`, label: `Arrears - ${p.month_name} ${p.year}`, amount })
    listed += amount
  }

  const residual = Math.round((prev - listed) * 100) / 100
  if (!lines.length) {
    lines.push({ key: 'prev', label: 'Previous Balance', amount: prev })
  } else if (residual > 0.5) {
    lines.push({ key: 'earlier', label: 'Arrears - Earlier Dues', amount: residual })
  }
  return lines
}

export default function InvoiceStudent() {
  const params = useParams()
  const id = params?.id
  const [record, setRecord] = useState(null)
  const [error, setError]   = useState(null)
  const printed = useRef(false)

  useEffect(() => {
    if (!id) return
    client.get(`/fees/records/${id}/invoice/`)
      .then(({ data }) => {
        setRecord(data)
      })
      .catch(() => setError('Could not load invoice'))
  }, [id])

  useEffect(() => {
    if (record && !printed.current) {
      printed.current = true
      setTimeout(() => window.print(), 600)
    }
  }, [record])

  if (error) return <div style={{ padding: 32, color: '#A23B32' }}>{error}</div>
  if (!record) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8 text-[#1E5C48]" />
      </div>
    )
  }

  const s = record.student
  const arrearLines = buildArrearLines(record)

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          @page { size: A5; margin: 12mm; }
        }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; }
        .invoice { background: white; max-width: 600px; margin: 20px auto; padding: 32px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
        .header { text-align: center; border-bottom: 2px solid #1E5C48; padding-bottom: 16px; margin-bottom: 20px; }
        .school-name { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #1E5C48; letter-spacing: 0.5px; }
        .school-sub  { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .invoice-title { font-size: 14px; font-weight: 700; color: #374151; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
        .receipt-no { font-size: 13px; color: #6b7280; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        td { padding: 6px 8px; font-size: 13px; }
        .label { color: #6b7280; width: 44%; }
        .value { color: #111827; font-weight: 500; }
        .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
          color: #6b7280; padding: 14px 8px 4px; border-top: 1px solid #e5e7eb; }
        .amount-row td { font-size: 14px; padding: 8px; }
        .total-row td { font-size: 15px; font-weight: 700; border-top: 2px solid #e5e7eb; padding-top: 10px; }
        .balance-row td { color: #dc2626; }
        .arrear-row td { color: #6b7280; }
        .arrear-row td.label { padding-left: 20px; }
        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
        .status-paid    { background: #dcfce7; color: #166534; }
        .status-partial { background: #fef9c3; color: #854d0e; }
        .status-unpaid  { background: #fee2e2; color: #991b1b; }
        .status-waived  { background: #f3f4f6; color: #4b5563; }
        .footer { margin-top: 28px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 12px; }
        .sig-row { display: flex; justify-content: space-between; margin-top: 36px; }
        .sig-box { text-align: center; font-size: 11px; color: #6b7280; }
        .sig-line { border-top: 1px solid #9ca3af; width: 120px; margin: 0 auto 6px; }
      `}</style>

      {/* Print button (hidden on print) */}
      <div className="no-print" style={{ textAlign: 'center', padding: '16px 0' }}>
        <button
          onClick={() => window.print()}
          style={{
            background: '#1E5C48', color: 'white', padding: '8px 24px',
            borderRadius: 8, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
          }}
        >
          Print invoice
        </button>
      </div>

      <div className="invoice">
        {/* Header */}
        <div className="header">
          <div className="school-name">The Creative School</div>
          <div className="school-sub">Fee Payment Invoice</div>
          <div className="invoice-title">Monthly Fee Receipt</div>
          <div className="receipt-no">Receipt No: <strong>{record.receipt_no}</strong> &nbsp;·&nbsp; Date: {record.receipt_date}</div>
        </div>

        {/* Student info */}
        <table>
          <tbody>
            <tr><td colSpan={2} className="section-title">Student Information</td></tr>
            <tr><td className="label">Student Name</td><td className="value">{s.student_name}</td></tr>
            <tr><td className="label">Admission No</td><td className="value">{s.admission_no}</td></tr>
            <tr><td className="label">Class</td><td className="value">{s.current_class}</td></tr>
            <tr><td className="label">Father / Guardian</td><td className="value">{s.f_g_name}</td></tr>
            <tr><td className="label">Contact</td><td className="value">{s.f_g_contact}</td></tr>
          </tbody>
        </table>

        {/* Fee details */}
        <table>
          <tbody>
            <tr><td colSpan={2} className="section-title">Fee Details - {MONTHS[record.month]} {record.year}</td></tr>
            <tr className="amount-row">
              <td className="label">Tuition Fee - {MONTHS[record.month]} {record.year}</td>
              <td className="value">Rs {Number(record.current_fee).toLocaleString()}</td>
            </tr>
            {Number(record.misc_charges) > 0 && (
              <tr className="amount-row">
                <td className="label">Other Charges - {MONTHS[record.month]} {record.year}</td>
                <td className="value">Rs {Number(record.misc_charges).toLocaleString()}</td>
              </tr>
            )}
            {/* Arrears itemised by the month each one is owed for, so the
                previous balance is never an unexplained lump sum. */}
            {arrearLines.map((line) => (
              <tr className="amount-row arrear-row" key={line.key}>
                <td className="label">{line.label}</td>
                <td className="value">Rs {line.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td className="label">Total Amount</td>
              <td className="value">Rs {Number(record.total_amount).toLocaleString()}</td>
            </tr>
            <tr className="amount-row">
              <td className="label">Amount Paid</td>
              <td className="value" style={{ color: '#16a34a' }}>Rs {Number(record.amount_paid).toLocaleString()}</td>
            </tr>
            {Number(record.balance) > 0 && (
              <tr className="balance-row amount-row">
                <td className="label">Balance Due</td>
                <td className="value">Rs {Number(record.balance).toLocaleString()}</td>
              </tr>
            )}
            <tr>
              <td className="label">Due Date</td>
              <td className="value">{record.due_date}</td>
            </tr>
            {record.payment_date && (
              <tr>
                <td className="label">Payment Date</td>
                <td className="value">{record.payment_date}</td>
              </tr>
            )}
            <tr>
              <td className="label">Status</td>
              <td className="value">
                <span className={`status-badge status-${record.status}`}>
                  {record.status.toUpperCase()}
                </span>
              </td>
            </tr>
            {record.remarks && (
              <tr>
                <td className="label">Remarks</td>
                <td className="value">{record.remarks}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Signatures */}
        <div className="sig-row">
          <div className="sig-box">
            <div className="sig-line" />
            Parent / Guardian Signature
          </div>
          <div className="sig-box">
            <div className="sig-line" />
            Accounts Officer
          </div>
        </div>

        <div className="footer">
          This is a computer-generated receipt. — The Creative School
        </div>
      </div>
    </>
  )
}
