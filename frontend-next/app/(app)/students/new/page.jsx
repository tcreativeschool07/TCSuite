import StudentForm from '../StudentForm'

// /students/new — create mode (no [id] param, so StudentForm's isEdit is false)
export default function NewStudentPage() {
  return <StudentForm />
}
