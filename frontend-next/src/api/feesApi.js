import client from './client'

// ── ClassRooms ───────────────────────────────────────
export const getClassRooms = (params) =>
  client.get('/fees/classrooms/', { params })

export const getClassRoomsWithFeeStats = (params) =>
  client.get('/fees/classrooms/with-fee-stats/', { params })

export const syncClassRooms = () =>
  client.post('/fees/classrooms/sync-from-students/')

export const getClassStudentsFee = (classId, params) =>
  client.get(`/fees/classrooms/${classId}/students-fee/`, { params })

// ── Academic Years ───────────────────────────────────
export const getAcademicYears = () =>
  client.get('/fees/academic-years/')

export const createAcademicYear = (data) =>
  client.post('/fees/academic-years/', data)

// ── Fee Structures ───────────────────────────────────
export const getFeeStructures = (params) =>
  client.get('/fees/structures/', { params })

export const getFeeStructure = (id) =>
  client.get(`/fees/structures/${id}/`)

export const createFeeStructure = (data) =>
  client.post('/fees/structures/', data)

export const updateFeeStructure = (id, data) =>
  client.put(`/fees/structures/${id}/`, data)

export const deleteFeeStructure = (id) =>
  client.delete(`/fees/structures/${id}/`)

// ── Fee Records ──────────────────────────────────────
export const getFeeRecords = (params) =>
  client.get('/fees/records/', { params })

export const getFeeRecord = (id) =>
  client.get(`/fees/records/${id}/`)

export const createFeeRecord = (data) =>
  client.post('/fees/records/', data)

export const recordPayment = (id, data) =>
  client.patch(`/fees/records/${id}/record-payment/`, data)

export const getArrearsBreakdown = (id) =>
  client.get(`/fees/records/${id}/arrears-breakdown/`)

export const editFeeRecord = (id, data) =>
  client.patch(`/fees/records/${id}/edit-record/`, data)

export const deleteFeeRecord = (id) =>
  client.delete(`/fees/records/${id}/`)

export const getFeeSummary = (params) =>
  client.get('/fees/records/summary/', { params })

export const getBalanceSheet = (params) =>
  client.get('/fees/records/balance-sheet/', { params })

export const getTopDefaulters = (params) =>
  client.get('/fees/records/top-defaulters/', { params })

export const getDistinctYears = () =>
  client.get('/fees/records/distinct-years/')

export const getStudentFeeHistory = (params) =>
  client.get('/fees/records/student-fee-history/', { params })

export const lookupReceipt = (receipt) =>
  client.get('/fees/records/lookup-receipt/', { params: { receipt } })

export const downloadBalanceSheetPdf = (params) =>
  client.get('/fees/records/balance-sheet-pdf/', { params, responseType: 'blob' })

export const bulkGenerateFeeRecords = (data) =>
  client.post('/fees/records/bulk-generate/', data)

export const advancePayment = (data) =>
  client.post('/fees/records/advance-payment/', data)

// ── Invoices ─────────────────────────────────────────
export const getStudentInvoice = (id) =>
  client.get(`/fees/records/${id}/invoice/`)

export const getClassInvoice = (params) =>
  client.get('/fees/records/class-invoice/', { params })

export const downloadStudentInvoicePdf = (id) =>
  client.get(`/fees/records/${id}/invoice-pdf/`, { responseType: 'blob' })

// The class collection sheet is a workbook, not a PDF — staff tick payments
// off against it and re-total, so it has to be editable.
export const downloadClassCollectionXlsx = (params) =>
  client.get('/fees/records/class-collection-xlsx/', { params, responseType: 'blob' })

export const downloadBulkInvoicesPdf = (params) =>
  client.get('/fees/records/bulk-invoices-pdf/', { params, responseType: 'blob' })

// ── ClassRoom CRUD ───────────────────────────────────
export const createClassRoom = (data) =>
  client.post('/fees/classrooms/', data)

export const updateClassRoom = (id, data) =>
  client.put(`/fees/classrooms/${id}/`, data)

export const deleteClassRoom = (id) =>
  client.delete(`/fees/classrooms/${id}/`)

// ── Academic Year CRUD ───────────────────────────────
export const updateAcademicYear = (id, data) =>
  client.put(`/fees/academic-years/${id}/`, data)

export const deleteAcademicYear = (id) =>
  client.delete(`/fees/academic-years/${id}/`)

// ── Saved Balance Sheets ────────────────────────────
export const getSavedBalanceSheets = () =>
  client.get('/fees/saved-balance-sheets/')

export const getSavedBalanceSheet = (id) =>
  client.get(`/fees/saved-balance-sheets/${id}/`)

export const downloadSavedBalanceSheetPdf = (id) =>
  client.get(`/fees/saved-balance-sheets/${id}/download-pdf/`, { responseType: 'blob' })

// ── Custom receipts ──────────────────────────────
// A hand-built receipt for one student, composed from their outstanding dues.
export const getNextReceiptNumber = () =>
  client.get('/fees/custom-receipts/next-number/')

export const getStudentDues = (params) =>
  client.get('/fees/custom-receipts/student-dues/', { params })

export const createCustomReceipt = (data) =>
  client.post('/fees/custom-receipts/', data)

export const downloadCustomReceiptPdf = (id) =>
  client.get(`/fees/custom-receipts/${id}/pdf/`, { responseType: 'blob' })

// ── Charge Categories ────────────────────────────
export const getChargeCategories = (params) =>
  client.get('/fees/charge-categories/', { params })

export const createChargeCategory = (data) =>
  client.post('/fees/charge-categories/', data)

export const updateChargeCategory = (id, data) =>
  client.put(`/fees/charge-categories/${id}/`, data)

export const deleteChargeCategory = (id) =>
  client.delete(`/fees/charge-categories/${id}/`)

// ── Misc Charges ─────────────────────────────────
export const getMiscCharges = (params) =>
  client.get('/fees/misc-charges/', { params })

export const createMiscCharge = (data) =>
  client.post('/fees/misc-charges/', data)

export const deleteMiscCharge = (id) =>
  client.delete(`/fees/misc-charges/${id}/`)

export const getMiscChargeSummary = (params) =>
  client.get('/fees/misc-charges/student-summary/', { params })
