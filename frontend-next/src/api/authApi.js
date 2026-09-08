import client from './client'

export const login = (username, password) =>
  client.post('/accounts/login/', { username, password })

export const getProfile = () =>
  client.get('/accounts/me/')
