import React, { useState, useEffect, useCallback } from 'react';
import {
  adminLogin, getAdminStats, getAdminQs,
  addQuestion, editQuestion, deleteQuestion,
  triggerRefill, getCategories_a,
} from '../api';

const INITIAL_FORM = { category: '', question: '', answer: '', is_pie: false, canadian: false };

export default function AdminPanel() {
  const [token,      setToken]      = useState(localStorage.getItem('admin_token'));
  const [loginForm,  setLoginForm]  = useState({ username: '', password: '' });
  const [loginErr,   setLoginErr]   = useState('');
  const [stats,      setStats]      = useState(null);
  const [questions,  setQuestions]  = useState([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [filters,    setFilters]    = useState({ category: '', used: '', search: '', isPie: '' });
  const [categories, setCategories] = useState([]);
  const [form,       setForm]       = useState(INITIAL_FORM);
  const [editing,    setEditing]    = useState(null);
  const [formErr,    setFormErr]    = useState('');
  const [formOk,     setFormOk]     = useState('');
  const [refillMsg,  setRefillMsg]  = useState('');
  const [loading,    setLoading]    = useState(false);

  const logout = () => {
    localStorage.removeItem('admin_token');
    setToken(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginErr('');
    try {
      const data = await adminLogin(loginForm.username, loginForm.password);
      localStorage.setItem('admin_token', data.token);
      setToken(data.token);
    } catch (err) {
      setLoginErr(err.message);
    }
  };

  const loadStats = useCallback(async () => {
    try { setStats(await getAdminStats()); } catch {}
  }, []);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filters.category) params.category = filters.category;
      if (filters.used !== '') params.used = filters.used;
      if (filters.search)  params.search  = filters.search;
      if (filters.isPie !== '') params.isPie = filters.isPie;
      const data = await getAdminQs(params);
      setQuestions(data.questions);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {}
    setLoading(false);
  }, [page, filters]);

  const loadCategories = useCallback(async () => {
    try { const d = await getCategories_a(); setCategories(d.categories); } catch {}
  }, []);

  useEffect(() => {
    if (token) { loadStats(); loadQuestions(); loadCategories(); }
  }, [token, loadStats, loadQuestions, loadCategories]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormErr(''); setFormOk('');
    if (!form.category || !form.question || !form.answer) {
      setFormErr('Category, question, and answer are required.'); return;
    }
    try {
      if (editing) {
        await editQuestion(editing, form);
        setFormOk('Question updated.');
        setEditing(null);
      } else {
        await addQuestion(form);
        setFormOk('Question added.');
      }
      setForm(INITIAL_FORM);
      loadStats(); loadQuestions();
    } catch (err) { setFormErr(err.message); }
  };

  const handleEdit = (q) => {
    setEditing(q.id);
    setForm({ category: q.category, question: q.question, answer: q.answer, is_pie: q.is_pie, canadian: q.canadian });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this question?')) return;
    try { await deleteQuestion(id); loadStats(); loadQuestions(); } catch {}
  };

  const handleRefill = async () => {
    setRefillMsg('Starting refill...');
    try {
      const r = await triggerRefill();
      setRefillMsg(r.message);
      setTimeout(() => { loadStats(); loadQuestions(); }, 5000);
    } catch (err) { setRefillMsg('Error: ' + err.message); }
  };

  // ── LOGIN ───────────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div style={S.page}>
        <div style={{ width: '100%', maxWidth: 380, background: '#111', border: '1px solid #222', borderRadius: 12, padding: 28 }}>
          <h2 style={{ color: '#fff', fontFamily: 'monospace', marginTop: 0 }}>🔐 Admin Login</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Username" value={loginForm.username} onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))} style={S.input} />
            <input placeholder="Password" type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} style={S.input} />
            {loginErr && <div style={{ color: '#f87171', fontSize: 12, fontFamily: 'monospace' }}>{loginErr}</div>}
            <button type="submit" style={S.btn('#3b82f6')}>LOGIN</button>
          </form>
        </div>
      </div>
    );
  }

  // ── ADMIN PANEL ─────────────────────────────────────────────────────────────
  return (
    <div style={{ ...S.page, alignItems: 'flex-start', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: 900 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ color: '#fff', fontFamily: 'monospace', margin: 0, fontSize: 20 }}>🎲 Trivia Admin</h1>
          <button onClick={logout} style={S.btn('#555', { padding: '5px 12px', fontSize: 11 })}>LOGOUT</button>
        </div>

        {/* Stats row */}
        {stats && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <div style={S.statCard}>
              <div style={{ color: stats.stats.total < 250 ? '#f87171' : '#4ade80', fontSize: 28, fontWeight: 900, fontFamily: 'monospace' }}>{stats.stats.total}</div>
              <div style={{ color: '#555', fontSize: 10, fontFamily: 'monospace' }}>AVAILABLE QUESTIONS</div>
              {stats.stats.total < 250 && <div style={{ color: '#f87171', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>⚠ BELOW THRESHOLD</div>}
              {stats.refilling && <div style={{ color: '#fbbf24', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>🔄 REFILLING...</div>}
            </div>
            {stats.stats.byCategory.map(row => (
              <div key={row.category} style={{ ...S.statCard, minWidth: 140 }}>
                <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{parseInt(row.available)}</div>
                <div style={{ color: '#555', fontSize: 9, fontFamily: 'monospace' }}>{row.category}</div>
                <div style={{ color: '#333', fontSize: 9, fontFamily: 'monospace' }}>pie: {row.pie} | used: {row.used_count}</div>
              </div>
            ))}
          </div>
        )}

        {/* Refill controls */}
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 14, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={handleRefill} style={S.btn('#d97706')}>🤖 GENERATE 250 QUESTIONS WITH AI</button>
          {refillMsg && <div style={{ color: '#aaa', fontSize: 12, fontFamily: 'monospace' }}>{refillMsg}</div>}
        </div>

        {/* Add / Edit form */}
        <div style={{ background: '#111', border: `1px solid ${editing ? '#d97706' : '#222'}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ color: editing ? '#d97706' : '#fff', fontFamily: 'monospace', marginTop: 0, fontSize: 13 }}>
            {editing ? '✏️ EDITING QUESTION #' + editing : '➕ ADD QUESTION'}
          </h3>
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={S.input}>
              <option value="">-- Select Category --</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <textarea
              placeholder="Question text"
              value={form.question}
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              style={{ ...S.input, minHeight: 70, resize: 'vertical' }}
            />
            <textarea
              placeholder="Answer"
              value={form.answer}
              onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
              style={{ ...S.input, minHeight: 50, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.is_pie} onChange={e => setForm(f => ({ ...f, is_pie: e.target.checked }))} />
                Pie question
              </label>
              <label style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.canadian} onChange={e => setForm(f => ({ ...f, canadian: e.target.checked }))} />
                🍁 Canadian
              </label>
            </div>
            {formErr && <div style={{ color: '#f87171', fontSize: 12, fontFamily: 'monospace' }}>{formErr}</div>}
            {formOk  && <div style={{ color: '#4ade80', fontSize: 12, fontFamily: 'monospace' }}>{formOk}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={S.btn('#3b82f6')}>{editing ? 'SAVE CHANGES' : 'ADD QUESTION'}</button>
              {editing && <button type="button" onClick={() => { setEditing(null); setForm(INITIAL_FORM); }} style={S.btn('#555')}>CANCEL</button>}
            </div>
          </form>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input placeholder="Search..." value={filters.search} onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }} style={{ ...S.input, maxWidth: 200 }} />
          <select value={filters.category} onChange={e => { setFilters(f => ({ ...f, category: e.target.value })); setPage(1); }} style={{ ...S.input, maxWidth: 200 }}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.used} onChange={e => { setFilters(f => ({ ...f, used: e.target.value })); setPage(1); }} style={{ ...S.input, maxWidth: 140 }}>
            <option value="">All (used/unused)</option>
            <option value="false">Unused only</option>
            <option value="true">Used only</option>
          </select>
          <select value={filters.isPie} onChange={e => { setFilters(f => ({ ...f, isPie: e.target.value })); setPage(1); }} style={{ ...S.input, maxWidth: 130 }}>
            <option value="">All types</option>
            <option value="false">Regular</option>
            <option value="true">Pie only</option>
          </select>
        </div>

        {/* Questions table */}
        <div style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', marginBottom: 8 }}>
          Showing {questions.length} of {total} questions
        </div>

        {loading ? (
          <div style={{ color: '#444', fontFamily: 'monospace', fontSize: 12, padding: 20 }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {questions.map(q => (
              <div key={q.id} style={{
                background: '#111', border: `1px solid ${q.used ? '#1a1a1a' : '#222'}`,
                borderLeft: `3px solid ${q.used ? '#333' : q.is_pie ? '#fbbf24' : '#3b82f6'}`,
                borderRadius: 6, padding: '10px 12px', opacity: q.used ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#555', fontFamily: 'monospace', marginBottom: 4 }}>
                      #{q.id} · {q.category} {q.is_pie ? '🥧' : ''} {q.canadian ? '🍁' : ''} {q.used ? '· USED' : ''}
                    </div>
                    <div style={{ color: q.used ? '#444' : '#ddd', fontSize: 13, marginBottom: 4 }}>{q.question}</div>
                    <div style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}>{q.answer}</div>
                  </div>
                  {!q.used && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => handleEdit(q)} style={{ padding: '3px 8px', background: 'transparent', border: '1px solid #333', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>EDIT</button>
                      <button onClick={() => handleDelete(q.id)} style={{ padding: '3px 8px', background: 'transparent', border: '1px solid #7f1d1d', borderRadius: 4, color: '#f87171', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>DEL</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={S.btn('#333', { padding: '5px 12px' })}>←</button>
            <span style={{ color: '#555', fontFamily: 'monospace', fontSize: 12, padding: '5px 0' }}>Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={S.btn('#333', { padding: '5px 12px' })}>→</button>
          </div>
        )}

        {/* Refill log */}
        {stats?.refillLog?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ color: '#444', fontSize: 11, fontFamily: 'monospace', marginBottom: 8 }}>REFILL LOG</div>
            {stats.refillLog.map(r => (
              <div key={r.id} style={{ fontSize: 10, color: '#333', fontFamily: 'monospace', marginBottom: 4 }}>
                {new Date(r.triggered_at).toLocaleString()} · +{r.questions_added} questions · was {r.bank_count_before} · {r.status}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 12px 40px', fontFamily: 'Georgia, serif' },
  input: { background: '#0d0d0d', border: '1px solid #222', borderRadius: 6, padding: '8px 12px', color: '#ddd', fontSize: 13, fontFamily: 'monospace', width: '100%', boxSizing: 'border-box' },
  statCard: { background: '#111', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 14px', minWidth: 100 },
  btn: (color, extra = {}) => ({
    padding: '8px 16px', borderRadius: 6, border: `1px solid ${color}`, background: `${color}18`,
    color: color === '#555' ? '#888' : color, cursor: 'pointer', fontSize: 12, fontFamily: 'monospace',
    letterSpacing: 1, ...extra,
  }),
};
