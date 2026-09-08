'use client'

// Balance sheet — data loading (including the saved-sheet archive reload),
// both PDF downloads, and window.print() verbatim from pages/fees/BalanceSheet.jsx.
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  getBalanceSheet, downloadBalanceSheetPdf,
  getSavedBalanceSheets, downloadSavedBalanceSheetPdf,
} from '@/src/api/feesApi'
import useYears from '@/src/hooks/useYears'
import { Icon, Spinner } from '@/src/components/icons'
import { TableSkeleton, EmptyState, Skeleton } from '@/src/components/Skeleton'

const NOW = new Date()

export default function BalanceSheet() {
  const yearOptions = useYears()
  const [year, setYear]       = useState(String(NOW.getFullYear()))
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  const [savedSheets, setSavedSheets]         = useState([])
  const [savedLoading, setSavedLoading]       = useState(false)
  const [savedPdfLoading, setSavedPdfLoading] = useState(null)

  const loadSavedSheets = () => {
    setSavedLoading(true)
    getSavedBalanceSheets()
      .then(({ data: res }) => setSavedSheets(res.results ?? res))
      .catch(() => {})
      .finally(() => setSavedLoading(false))
  }

  const load = useCallback(() => {
    setLoading(true)
    getBalanceSheet({ year })
      .then(({ data: res }) => {
        setData(res)
        loadSavedSheets()
      })
      .catch(() => toast.error('Failed to load balance sheet'))
      .finally(() => setLoading(false))
  }, [year])

  useEffect(() => { load() }, [load])

  useEffect(() => { loadSavedSheets() }, [])

  const [pdfLoading, setPdfLoading] = useState(false)

  const fmt = (v) => `Rs ${Number(v || 0).toLocaleString()}`

  const handleDownloadPdf = async () => {
    setPdfLoading(true)
    try {
      const { data: blob } = await downloadBalanceSheetPdf({ year })
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Balance_Sheet_${year}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Balance sheet PDF downloaded')
    } catch {
      toast.error('Failed to download balance sheet PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const handleDownloadSavedPdf = async (sheet) => {
    setSavedPdfLoading(sheet.id)
    try {
      const { data: blob } = await downloadSavedBalanceSheetPdf(sheet.id)
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Balance_Sheet_${sheet.year}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Balance sheet for ${sheet.year} downloaded`)
    } catch {
      toast.error('Failed to download PDF')
    } finally {
      setSavedPdfLoading(null)
    }
  }

  const rateBar = (rate) => (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-20 bg-rule rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${rate >= 80 ? 'bg-ok' : rate >= 50 ? 'bg-warn' : 'bg-danger'}`}
          style={{ width: `${rate}%` }}
        />
      </div>
      <span className="num text-[12px] font-medium text-ink-2 w-10 text-right">{rate}%</span>
    </div>
  )

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Balance sheet</h1>
          <p className="text-[13px] text-ink-3 mt-1">Comprehensive annual financial overview — auto-saved for each year</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="label" htmlFor="bs-year">Year</label>
            <select id="bs-year" className="input w-32" value={year} onChange={e => setYear(e.target.value)}>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading || loading || !data}
            className="btn btn-primary"
          >
            <Icon name="download" size={16} />
            {pdfLoading ? 'Downloading…' : 'Download PDF'}
          </button>
          <button onClick={() => window.print()} className="btn btn-secondary">
            <Icon name="printer" size={16} />
            Print
          </button>
        </div>
      </div>

      {loading && !data ? (
        <>
          <div className="panel p-6 space-y-4">
            <Skeleton className="h-5 w-52" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          </div>
          <div className="panel"><TableSkeleton rows={8} cols={8} /></div>
        </>
      ) : !data ? (
        <div className="panel">
          <EmptyState message={`No data available for ${year}.`} />
        </div>
      ) : (
        <>
          {/* Yearly summary */}
          {data.yearly_summary && (() => {
            const ys = data.yearly_summary
            return (
              <div className="panel p-6">
                <h2 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">
                  Annual summary — <span className="num">{year}</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  {[
                    { label: 'Total students', value: ys.total_students, cls: 'text-ink' },
                    { label: 'Records', value: ys.total_records, cls: 'text-ink' },
                    { label: 'Total fee', value: fmt(ys.total_fee), cls: 'text-ink' },
                    { label: 'Total due', value: fmt(ys.total_due), cls: 'text-ink' },
                    { label: 'Collected', value: fmt(ys.total_collected), cls: 'text-ok' },
                    { label: 'Outstanding', value: fmt(ys.total_balance), cls: 'text-danger' },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-[13px] text-ink-2">{item.label}</p>
                      <p className={`num text-[17px] font-semibold mt-0.5 ${item.cls}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-4">
                  <div className="flex-1 bg-rule rounded-full h-2">
                    <div
                      className="bg-ok h-2 rounded-full transition-all"
                      style={{ width: `${ys.collection_rate}%` }}
                    />
                  </div>
                  <span className="num text-[13.5px] font-semibold text-ok">{ys.collection_rate}% collected</span>
                </div>
                <div className="flex gap-4 mt-3 text-[13px] text-ink-2">
                  <span>Paid <strong className="num text-ok">{ys.paid}</strong></span>
                  <span>Partial <strong className="num text-warn">{ys.partial}</strong></span>
                  <span>Unpaid <strong className="num text-danger">{ys.unpaid}</strong></span>
                  <span>Arrears carried <strong className="num text-ink">{fmt(ys.total_prev_balance)}</strong></span>
                </div>
              </div>
            )
          })()}

          {/* Monthly breakdown */}
          <div className="panel overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-rule">
              <h2 className="text-[16px] font-semibold text-ink">Month-by-month breakdown</h2>
            </div>
            {data.monthly && data.monthly.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="ledger min-w-[900px]">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="text-right">Records</th>
                      <th className="text-right">Monthly fee</th>
                      <th className="text-right">Prev balance</th>
                      <th className="text-right">Total due</th>
                      <th className="text-right">Collected</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-center">Collection %</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly.map(m => {
                      const rate = m.total_due > 0 ? Math.round((m.total_collected / m.total_due) * 100) : 0
                      return (
                        <tr key={m.month}>
                          <td className="font-medium">{m.month_name}</td>
                          <td className="num text-right text-[13px]">{m.records}</td>
                          <td className="num text-right text-[13px]">{fmt(m.total_fee)}</td>
                          <td className="num text-right text-[13px]">
                            {m.prev_balance > 0
                              ? <span className="text-warn">{fmt(m.prev_balance)}</span>
                              : <span className="text-ink-3">0</span>}
                          </td>
                          <td className="num text-right text-[13px] font-medium">{fmt(m.total_due)}</td>
                          <td className="num text-right text-[13px] text-ok">{fmt(m.total_collected)}</td>
                          <td className="num text-right text-[13px]">
                            {m.total_balance > 0
                              ? <span className="text-danger font-medium">{fmt(m.total_balance)}</span>
                              : <span className="text-ink-3">0</span>}
                          </td>
                          <td className="text-center">{rateBar(rate)}</td>
                          <td className="text-center">
                            <div className="flex items-center gap-1 justify-center text-[12px]">
                              <span className="num badge badge-ok !px-1.5 !py-0.5">{m.paid}</span>
                              {m.partial > 0 && <span className="num badge badge-warn !px-1.5 !py-0.5">{m.partial}</span>}
                              {m.unpaid > 0 && <span className="num badge badge-danger !px-1.5 !py-0.5">{m.unpaid}</span>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num text-right">{data.monthly.reduce((s, m) => s + m.records, 0)}</td>
                      <td className="num text-right">{fmt(data.monthly.reduce((s, m) => s + m.total_fee, 0))}</td>
                      <td className="num text-right text-warn">{fmt(data.monthly.reduce((s, m) => s + m.prev_balance, 0))}</td>
                      <td className="num text-right">{fmt(data.monthly.reduce((s, m) => s + m.total_due, 0))}</td>
                      <td className="num text-right text-ok">{fmt(data.monthly.reduce((s, m) => s + m.total_collected, 0))}</td>
                      <td className="num text-right text-danger">{fmt(data.monthly.reduce((s, m) => s + m.total_balance, 0))}</td>
                      <td className="num text-center">
                        {data.yearly_summary ? `${data.yearly_summary.collection_rate}%` : '—'}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState message={`No monthly data for ${year}.`} />
            )}
          </div>

          {/* Class-wise breakdown */}
          <div className="panel overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-rule">
              <h2 className="text-[16px] font-semibold text-ink">Class-wise annual summary</h2>
            </div>
            {data.class_wise && data.class_wise.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="ledger min-w-[750px]">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th className="text-right">Students</th>
                      <th className="text-right">Records</th>
                      <th className="text-right">Total due</th>
                      <th className="text-right">Collected</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-center">Collection rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.class_wise.map(c => (
                      <tr key={c.class_name}>
                        <td className="font-medium">{c.class_name}</td>
                        <td className="num text-right text-[13px]">{c.student_count}</td>
                        <td className="num text-right text-[13px]">{c.records}</td>
                        <td className="num text-right text-[13px] font-medium">{fmt(c.total_due)}</td>
                        <td className="num text-right text-[13px] text-ok">{fmt(c.total_collected)}</td>
                        <td className="num text-right text-[13px]">
                          {c.total_balance > 0
                            ? <span className="text-danger font-medium">{fmt(c.total_balance)}</span>
                            : <span className="text-ink-3">0</span>}
                        </td>
                        <td className="text-center">{rateBar(c.collection_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num text-right">{data.class_wise.reduce((s, c) => s + c.student_count, 0)}</td>
                      <td className="num text-right">{data.class_wise.reduce((s, c) => s + c.records, 0)}</td>
                      <td className="num text-right">{fmt(data.class_wise.reduce((s, c) => s + c.total_due, 0))}</td>
                      <td className="num text-right text-ok">{fmt(data.class_wise.reduce((s, c) => s + c.total_collected, 0))}</td>
                      <td className="num text-right text-danger">{fmt(data.class_wise.reduce((s, c) => s + c.total_balance, 0))}</td>
                      <td className="num text-center">
                        {data.yearly_summary ? `${data.yearly_summary.collection_rate}%` : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState message={`No class-wise data for ${year}.`} />
            )}
          </div>
        </>
      )}

      {/* Saved balance sheets archive */}
      <div className="panel overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-rule">
          <h2 className="text-[16px] font-semibold text-ink">Saved balance sheets</h2>
          <p className="text-[13px] text-ink-3">Balance sheets are auto-saved each time you view a year. Download any past year.</p>
        </div>
        {savedLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : savedSheets.length === 0 ? (
          <EmptyState message="No saved balance sheets yet. View a year above to auto-save it." />
        ) : (
          <div>
            {savedSheets.map(sheet => (
              <div key={sheet.id} className="px-5 py-3 flex items-center justify-between border-b border-rule last:border-b-0 hover:bg-surface-sunken transition-colors duration-120">
                <div>
                  <p className="font-medium text-ink">Balance sheet — <span className="num">{sheet.year}</span></p>
                  <p className="num text-[12.5px] text-ink-3">
                    Last updated {new Date(sheet.generated_at).toLocaleDateString()} {new Date(sheet.generated_at).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setYear(String(sheet.year))}
                    className="btn btn-secondary btn-sm"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDownloadSavedPdf(sheet)}
                    disabled={savedPdfLoading === sheet.id}
                    className="btn btn-secondary btn-sm"
                  >
                    {savedPdfLoading === sheet.id ? (<><Spinner /> Downloading…</>) : 'Download PDF'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
