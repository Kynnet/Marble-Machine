async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    // Same-origin session cookie: no CORS, no cross-site cookie rules.
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const api = {
  me: () => request('/auth/me'),
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  listBoards: () => request('/boards'),
  saveBoard: (name, data) => request('/boards', { method: 'POST', body: { name, data } }),
  loadBoard: (id) => request(`/boards/${id}`),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),
};
