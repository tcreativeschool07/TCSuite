'use client'

// Student create/edit form. Fields, validation, error placement,
// payload shaping, and navigation are verbatim from pages/students/StudentForm.jsx.
// FieldGroup is now a Panel-with-header; labels are sentence case.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { getStudent, createStudent, updateStudent } from '@/src/api/studentsApi'
import useClassOptions from '@/src/hooks/useClassOptions'
import { Spinner } from '@/src/components/icons'
import { Skeleton } from '@/src/components/Skeleton'

const INITIAL = {
  admission_no: '', date_of_admission: '',
  student_name: '',
  b_form: '', dob: '', religion: '', tribe_caste: '', address: '',
  f_g_name: '', f_g_cnic: '', f_g_occupation: '', f_g_contact: '',
  class_of_admission: '', current_class: '',
  current_fee: '',
  withdrawn: 'no', class_of_withdrawl: '',
  arrear_dues: '', remarks: '',
  email: '', password: '',
}

function FieldGroup({ children, title }) {
  return (
    <div className="panel p-5">
      <h3 className="text-[16px] font-semibold text-ink pb-3 mb-4 border-b border-rule">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  )
}

function Field({ label, required, children, span }) {
  return (
    <div className={span ? 'sm:col-span-2' : ''}>
      <label className="label">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function StudentForm() {
  const params = useParams()
  const id = params?.id
  const router = useRouter()
  const isEdit = !!id

  const [form, setForm]         = useState(INITIAL)
  const [errors, setErrors]     = useState({})
  const [loading, setLoading]   = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const classOptions = useClassOptions()

  useEffect(() => {
    if (!isEdit) return
    getStudent(id)
      .then(({ data }) => {
        const vals = { ...INITIAL }
        Object.keys(INITIAL).forEach((k) => { if (data[k] !== undefined) vals[k] = data[k] ?? '' })
        vals.password = ''
        setForm(vals)
      })
      .catch(() => toast.error('Failed to load student'))
      .finally(() => setFetching(false))
  }, [id, isEdit])

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    if (errors[field]) setErrors({ ...errors, [field]: undefined })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErrors({})
    try {
      const payload = { ...form }
      if (!payload.current_fee) payload.current_fee = null
      // PARITY: date fields are CharField on the backend — send empty string when blank, never null
      if (!payload.date_of_admission) payload.date_of_admission = ''
      if (!payload.dob) payload.dob = ''
      if (isEdit && !payload.password) delete payload.password
      if (isEdit) {
        await updateStudent(id, payload)
        toast.success('Student updated')
        router.push(`/students/${id}`)
      } else {
        const { data } = await createStudent(payload)
        toast.success('Student enrolled')
        router.push(`/students/${data.id}`)
      }
    } catch (err) {
      if (err.response?.data && typeof err.response.data === 'object') {
        setErrors(err.response.data)
        toast.error('Please fix the errors below')
      } else {
        toast.error('Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="max-w-content mx-auto px-6 py-6 space-y-5">
        <Skeleton className="h-8 w-56" />
        {[4, 6, 4].map((rows, i) => (
          <div key={i} className="panel p-5 space-y-4">
            <Skeleton className="h-5 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: rows }).map((_, j) => <Skeleton key={j} className="h-9" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const inp = (field, props = {}) => (
    <>
      <input
        className={`input ${errors[field] ? 'input-error' : ''}`}
        value={form[field]}
        onChange={set(field)}
        {...props}
      />
      {errors[field] && <p className="text-[13px] text-danger mt-1">{errors[field]}</p>}
    </>
  )

  const sel = (field, options) => (
    <>
      <select
        className={`input ${errors[field] ? 'input-error' : ''}`}
        value={form[field]}
        onChange={set(field)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
            {typeof o === 'string' ? o : o.label}
          </option>
        ))}
      </select>
      {errors[field] && <p className="text-[13px] text-danger mt-1">{errors[field]}</p>}
    </>
  )

  return (
    <div className="max-w-content mx-auto px-6 py-6 space-y-6">
      <div>
        <nav className="text-[13px] text-ink-3 mb-1" aria-label="Breadcrumb">
          <Link href="/students" className="hover:text-accent">Students</Link>
          <span className="mx-2">/</span>
          <span className="text-ink-2">{isEdit ? 'Edit' : 'Enrol new student'}</span>
        </nav>
        <h1 className="page-title">
          {isEdit ? 'Edit student' : 'Enrol new student'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Admission */}
        <FieldGroup title="Admission information">
          <Field label="Admission number" required>
            {inp('admission_no', { placeholder: 'e.g. 1525' })}
          </Field>
          <Field label="Date of admission">
            {inp('date_of_admission', { type: 'date' })}
          </Field>
        </FieldGroup>

        {/* Personal */}
        <FieldGroup title="Student personal information">
          <Field label="Full name" required span>
            {inp('student_name', { placeholder: 'Muhammad Ali' })}
          </Field>
          <Field label="B-Form / CNIC" required>
            {inp('b_form', { placeholder: '35201-XXXXXXX-X' })}
          </Field>
          <Field label="Date of birth">
            {inp('dob', { type: 'date' })}
          </Field>
          <Field label="Religion">
            {inp('religion', { placeholder: 'Islam' })}
          </Field>
          <Field label="Tribe / caste">
            {inp('tribe_caste')}
          </Field>
          <Field label="Address" span>
            <textarea
              className="input min-h-[80px] resize-none"
              value={form.address}
              onChange={set('address')}
              placeholder="Full address…"
            />
          </Field>
        </FieldGroup>

        {/* Guardian */}
        <FieldGroup title="Father / guardian information">
          <Field label="Name" required>
            {inp('f_g_name')}
          </Field>
          <Field label="CNIC (13 digits)" required>
            {inp('f_g_cnic', { placeholder: '3520112345671' })}
          </Field>
          <Field label="Occupation">
            {inp('f_g_occupation')}
          </Field>
          <Field label="Contact number" required>
            {inp('f_g_contact', { placeholder: '03001234567' })}
          </Field>
        </FieldGroup>

        {/* Academic */}
        <FieldGroup title="Academic and financial information">
          <Field label="Class of admission" required>
            {sel('class_of_admission', classOptions)}
          </Field>
          <Field label="Current class" required>
            {sel('current_class', classOptions)}
          </Field>
          <Field label="Individual monthly fee (Rs)">
            {inp('current_fee', {
              type: 'number', min: 0, step: '0.01',
              placeholder: 'Leave blank to use class fee structure',
            })}
            <p className="text-[13px] text-ink-3 mt-1">
              Overrides the class-level fee structure for this student.
            </p>
          </Field>
          <Field label="Arrear dues (Rs)">
            {inp('arrear_dues', { placeholder: '0' })}
          </Field>
          <Field label="Withdrawn">
            {sel('withdrawn', [{ value: 'no', label: 'No (active)' }, { value: 'yes', label: 'Yes' }])}
          </Field>
          {form.withdrawn === 'yes' && (
            <Field label="Class of withdrawal">
              {sel('class_of_withdrawl', classOptions)}
            </Field>
          )}
          <Field label="Remarks" span>
            <textarea className="input min-h-[80px] resize-none" value={form.remarks} onChange={set('remarks')} />
          </Field>
        </FieldGroup>

        {/* Credentials */}
        <FieldGroup title="Login credentials">
          <Field label="Email" required={!isEdit}>
            {inp('email', { type: 'email', placeholder: 'student@example.com' })}
          </Field>
          <Field label={isEdit ? 'New password (leave blank to keep)' : 'Password'} required={!isEdit}>
            {inp('password', { type: 'password', placeholder: isEdit ? 'Leave blank to keep current' : '••••••••' })}
          </Field>
        </FieldGroup>

        <div className="flex items-center gap-3 justify-end">
          <Link href={isEdit ? `/students/${id}` : '/students'} className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? (<><Spinner /> Saving…</>) : isEdit ? 'Save changes' : 'Enrol student'}
          </button>
        </div>
      </form>
    </div>
  )
}
