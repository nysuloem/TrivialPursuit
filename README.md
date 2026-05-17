# 🎲 Trivial Pursuit — Railway Deployment Guide

## What you're deploying

| Piece | What it does |
|---|---|
| **Backend** | Node/Express API + PostgreSQL connection |
| **Frontend** | React game + admin panel |
| **Database** | PostgreSQL (Railway add-on, free tier) |
| **AI Refill** | Auto-generates 250 questions via Claude when bank drops below 250 |

---

## Step 1 — Create a Railway account

1. Go to [railway.app](https://railway.app) and sign in (you already have an account)
2. Click **New Project**

---

## Step 2 — Add a PostgreSQL database

1. In your new project, click **+ Add Service → Database → PostgreSQL**
2. Railway creates a Postgres instance automatically
3. Click the Postgres service → **Variables** tab → copy `DATABASE_URL`

---

## Step 3 — Deploy the Backend

1. Click **+ Add Service → GitHub Repo**
2. Connect your GitHub account and push this project to a repo
3. Set the **Root Directory** to `backend`
4. Railway will auto-detect Node.js and run `npm start`

### Set these environment variables in Railway → Backend → Variables:

```
DATABASE_URL        = (paste from Postgres service)
JWT_SECRET          = (any long random string, e.g. openssl rand -hex 32)
ADMIN_USERNAME      = admin
ADMIN_PASSWORD      = (choose a strong password)
ANTHROPIC_API_KEY   = sk-ant-... (your Anthropic API key)
NODE_ENV            = production
FRONTEND_URL        = https://your-frontend.railway.app
LOW_QUESTION_THRESHOLD = 250
REFILL_AMOUNT       = 250
PORT                = 3001
```

---

## Step 4 — Seed the database

Once the backend is deployed and running:

1. Open your backend service in Railway → click **Deploy → Run Command**
2. Run: `node src/seed.js`
3. This calls Claude to generate the initial ~250 questions (takes 1–2 minutes)

Or locally (if DATABASE_URL is set):
```bash
cd backend
npm install
node src/seed.js
```

---

## Step 5 — Deploy the Frontend

1. Click **+ Add Service → GitHub Repo** again
2. Set **Root Directory** to `frontend`
3. Set **Build Command**: `npm run build`
4. Set **Start Command**: `npx serve -s build -l 3000`

### Set these environment variables:

```
REACT_APP_API_URL = https://your-backend.railway.app
```

---

## Step 6 — Test it

- **Game:** `https://your-frontend.railway.app`
- **Admin panel:** `https://your-frontend.railway.app/admin`
  - Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set above

---

## Admin Panel Features

| Feature | How |
|---|---|
| View bank count by category | Stats cards at top |
| Generate 250 AI questions | Click "GENERATE 250 QUESTIONS WITH AI" |
| Add a question manually | Fill in the form and submit |
| Edit a question | Click EDIT on any unused question |
| Delete a question | Click DEL |
| Filter/search | Use the filter bar above the list |
| View refill history | Refill log at the bottom |

---

## How the auto-refill works

1. After every question is answered, the backend checks the unused question count
2. If count drops below `LOW_QUESTION_THRESHOLD` (default 250):
   - A background job fires automatically
   - It calls Claude API in ~5 batches of ~50 questions each
   - New questions are inserted into the DB immediately
   - The game continues uninterrupted
3. You can also trigger manually from the admin panel

---

## Game Rules (for reference)

- **Boys vs Girls**, first to collect all **6 wedges** wins
- Each turn: team picks from **2 randomly offered categories**
- **2 correct answers in a row** in the same category → unlocks a **Pie Question**
- **Correct pie answer** → wins that category's wedge (permanent)
- **Wrong answer** → switches to the other team
- **Skip** → question is consumed and marked used, streak resets
- Questions are **permanently consumed** when answered or skipped

---

## Category breakdown

| Category | Emoji | Focus |
|---|---|---|
| Geography | 🌍 | World geography, capitals, landmarks |
| Entertainment & Music | 🎬 | Movies, TV, streaming, music, pop culture |
| History | 📜 | World history, recent events |
| Science & Nature | 🔬 | Science, tech, AI, space, nature |
| Sports & Video Games | 🎮 | Sports + gaming |
| Current Events & Trends | 📰 | 2020–2025 news, trends, social media |

**~10% of questions are Canadian** (marked with 🍁 in the game)

---

## Local development

```bash
# Backend
cd backend
cp .env.example .env
# Fill in .env with your local Postgres URL and keys
npm install
npm run dev   # runs on port 3001

# Frontend (new terminal)
cd frontend
npm install
npm start     # runs on port 3000, proxies API to 3001
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Not enough questions in bank" | Run seed script or click Generate in admin |
| Admin login fails | Check ADMIN_USERNAME and ADMIN_PASSWORD env vars |
| Questions not generating | Check ANTHROPIC_API_KEY is set correctly |
| CORS errors | Set FRONTEND_URL to your exact frontend Railway URL |
| DB connection fails | Make sure DATABASE_URL is set and includes `?sslmode=require` for production |
