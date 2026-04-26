require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { google } = require('googleapis');
const { Pool }   = require('pg');

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS - preflight 명시적 처리
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_data (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 세션 토큰을 DB에 영속적으로 저장 (기기 간 공유 가능)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_tokens (
      session_id  TEXT PRIMARY KEY,
      tokens      JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('✅ DB 초기화 완료');
}
initDB().catch(console.error);

// ── 세션 토큰 헬퍼 함수 (DB 기반) ──────────────────────────────────────────
async function saveToken(sessionId, tokens) {
  await pool.query(`
    INSERT INTO session_tokens (session_id, tokens, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (session_id) DO UPDATE SET tokens = $2, created_at = NOW()
  `, [sessionId, JSON.stringify(tokens)]);
}

async function getToken(sessionId) {
  if (!sessionId) return null;
  const result = await pool.query(
    'SELECT tokens FROM session_tokens WHERE session_id = $1',
    [sessionId]
  );
  return result.rows[0]?.tokens || null;
}

async function deleteToken(sessionId) {
  await pool.query(
    'DELETE FROM session_tokens WHERE session_id = $1',
    [sessionId]
  );
}
// ────────────────────────────────────────────────────────────────────────────

app.get('/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM dashboard_data');
    const data = {};
    result.rows.forEach(row => { data[row.key] = row.value; });
    res.json({ success: true, data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/data', async (req, res) => {
  try {
    const { data } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for(const [key, value] of Object.entries(data)){
        await client.query(`
          INSERT INTO dashboard_data (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, JSON.stringify(value)]);
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_ID = 'c49de85d370fc27c69a8d418cd26edf8138d23d4fd02d6dd0eee9127c74d11d6@group.calendar.google.com';

app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  res.json({ url });
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    const sessionId = Math.random().toString(36).slice(2) + Date.now();
    await saveToken(sessionId, tokens); // DB에 저장
    const frontendUrl = process.env.FRONTEND_URL || 'https://hawonie.github.io/2026-CP-Scholarship-Foundation';
    res.redirect(`${frontendUrl}?session=${sessionId}&tab=calendar`);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/auth/check', async (req, res) => {
  const tokens = await getToken(req.query.session);
  res.json({ valid: !!tokens });
});

app.post('/auth/logout', async (req, res) => {
  await deleteToken(req.body.session);
  res.json({ success: true });
});

app.get('/calendar/events', async (req, res) => {
  const tokens = await getToken(req.query.session);
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(now.getFullYear(), 0, 1).toISOString(),
      timeMax: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
      singleEvents: true, orderBy: 'startTime', maxResults: 200,
    });
    res.json({ events: response.data.items || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/calendar/events', async (req, res) => {
  const { session, event } = req.body;
  const tokens = await getToken(session);
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: { summary: event.title, description: event.desc||'', start: { date: event.start }, end: { date: event.end||event.start } },
    });
    res.json({ event: response.data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/calendar/events/:eventId', async (req, res) => {
  const { session, event } = req.body;
  const tokens = await getToken(session);
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.update({
      calendarId: CALENDAR_ID, eventId: req.params.eventId,
      requestBody: { summary: event.title, description: event.desc||'', start: { date: event.start }, end: { date: event.end||event.start } },
    });
    res.json({ event: response.data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/calendar/events/:eventId', async (req, res) => {
  const tokens = await getToken(req.query.session);
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: req.params.eventId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.json({ status: '✅ CP 장학회 백엔드 서버 정상 작동 중' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 서버 실행 중: http://localhost:${PORT}`));
