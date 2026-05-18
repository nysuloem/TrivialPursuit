const BASE = process.env.REACT_APP_API_URL || '';

async function request(path, options = {}) {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── Game ──────────────────────────────────────────────────────────────────────
export const getCategories   = (ownedCategories = []) => request('/game/categories', { method: 'POST', body: { ownedCategories } });
export const getAllCategories = ()           => request('/game/all-categories');
export const speakTTS        = (text, voice) => `${BASE}/api/tts`; // returns URL, called differently
export const getQuestion     = (category, isPie) => request('/game/question', { method: 'POST', body: { category, isPie } });
export const markAnswered    = (questionId) => request('/game/answer',   { method: 'POST', body: { questionId } });
export const getBankCount    = ()           => request('/game/bank-count');

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminLogin      = (u, p)       => request('/auth/login', { method: 'POST', body: { username: u, password: p } });
export const getAdminStats   = ()           => request('/admin/stats');
export const getAdminQs      = (params)     => request('/admin/questions?' + new URLSearchParams(params));
export const addQuestion     = (q)          => request('/admin/questions', { method: 'POST', body: q });
export const editQuestion    = (id, q)      => request(`/admin/questions/${id}`, { method: 'PUT', body: q });
export const deleteQuestion  = (id)         => request(`/admin/questions/${id}`, { method: 'DELETE' });
export const triggerRefill   = ()           => request('/admin/refill', { method: 'POST' });
export const getCategories_a = ()           => request('/admin/categories');
