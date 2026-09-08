import client from './client'

export const getStudents = (params) =>
  client.get('/students/', { params })

export const getStudentStats = () =>
  client.get('/students/stats/')

export const getStudent = (id) =>
  client.get(`/students/${id}/`)

export const createStudent = (data) =>
  client.post('/students/', data)

export const updateStudent = (id, data) =>
  client.put(`/students/${id}/`, data)

export const patchStudent = (id, data) =>
  client.patch(`/students/${id}/`, data)

export const deleteStudent = (id) =>
  client.delete(`/students/${id}/`)
