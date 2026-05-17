const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getAdminByUsername, createAdmin } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Middleware — attach to any protected route
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Login handler
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const admin = await getAdminByUsername(username);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: admin.username });
}

// One-time admin seeding — called on startup if no admin exists
async function ensureDefaultAdmin() {
  const existing = await getAdminByUsername(process.env.ADMIN_USERNAME || 'admin');
  if (!existing) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'changeme123', 10);
    await createAdmin(process.env.ADMIN_USERNAME || 'admin', hash);
    console.log(`✅ Default admin created: ${process.env.ADMIN_USERNAME || 'admin'}`);
  }
}

module.exports = { requireAuth, login, ensureDefaultAdmin };
