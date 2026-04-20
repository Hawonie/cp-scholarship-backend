require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// CORS - 프론트엔드 도메인 허용
const allowedOrigins = [
  'https://hawonie.github.io',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if(!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Google OAuth2 클라이언트
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI  // https://your-railway-app.up.railway.app/auth/callback
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_ID = 'c49de85d370fc27c69a8d418cd26edf8138d23d4fd02d6dd0eee9127c74d11d6@group.calendar.google.com';

// ── 토큰 임시 저장 (메모리) ──
// 실제 운영시 Redis나 DB 사용 권장
const tokenStore = {};

// ─────────────────────────────────
// 1. OAuth 로그인 URL 발급
// ─────────────────────────────────
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.json({ url });
});

// ─────────────────────────────────
// 2. OAuth 콜백 - 토큰 발급
// ─────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // 세션 ID 생성
    const sessionId = Math.random().toString(36).slice(2) + Date.now();
    tokenStore[sessionId] = tokens;
    // 프론트엔드로 리다이렉트 (sessionId 전달)
    const frontendUrl = process.env.FRONTEND_URL || 'https://hawonie.github.io/2026-CP-Scholarship-Foundation';
    res.redirect(`${frontendUrl}?session=${sessionId}&tab=calendar`);
  } catch(e) {
    console.error('OAuth 콜백 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────
// 3. 캘린더 이벤트 읽기 (GET)
// ─────────────────────────────────
app.get('/calendar/events', async (req, res) => {
  const { session } = req.query;
  const tokens = tokenStore[session];
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(now.getFullYear(), 0, 1).toISOString(),
      timeMax: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 200,
    });
    res.json({ events: response.data.items || [] });
  } catch(e) {
    console.error('캘린더 읽기 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────
// 4. 캘린더 이벤트 추가 (POST)
// ─────────────────────────────────
app.post('/calendar/events', async (req, res) => {
  const { session, event } = req.body;
  const tokens = tokenStore[session];
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: event.title,
        description: event.desc || '',
        start: { date: event.start },
        end:   { date: event.end || event.start },
      },
    });
    res.json({ event: response.data });
  } catch(e) {
    console.error('이벤트 추가 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────
// 5. 캘린더 이벤트 수정 (PUT)
// ─────────────────────────────────
app.put('/calendar/events/:eventId', async (req, res) => {
  const { session, event } = req.body;
  const tokens = tokenStore[session];
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: req.params.eventId,
      requestBody: {
        summary: event.title,
        description: event.desc || '',
        start: { date: event.start },
        end:   { date: event.end || event.start },
      },
    });
    res.json({ event: response.data });
  } catch(e) {
    console.error('이벤트 수정 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────
// 6. 캘린더 이벤트 삭제 (DELETE)
// ─────────────────────────────────
app.delete('/calendar/events/:eventId', async (req, res) => {
  const { session } = req.query;
  const tokens = tokenStore[session];
  if(!tokens) return res.status(401).json({ error: '로그인이 필요합니다' });

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: req.params.eventId,
    });
    res.json({ success: true });
  } catch(e) {
    console.error('이벤트 삭제 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────
// 7. 세션 확인
// ─────────────────────────────────
app.get('/auth/check', (req, res) => {
  const { session } = req.query;
  res.json({ valid: !!tokenStore[session] });
});

// ─────────────────────────────────
// 8. 로그아웃
// ─────────────────────────────────
app.post('/auth/logout', (req, res) => {
  const { session } = req.body;
  delete tokenStore[session];
  res.json({ success: true });
});

// Health check
app.get('/', (req, res) => res.json({ status: 'CP 장학회 백엔드 서버 정상 작동 중 ✅' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 서버 실행 중: http://localhost:${PORT}`));
