# CP 장학회 백엔드 서버

Google Calendar OAuth2 연동을 위한 백엔드 서버입니다.

## 배포 순서

### 1. Google Cloud Console 설정
1. [console.cloud.google.com](https://console.cloud.google.com) 접속
2. 사용자 인증 정보 → **OAuth 2.0 클라이언트 ID** 생성
3. 애플리케이션 유형: **웹 애플리케이션**
4. 승인된 리디렉션 URI: `https://your-railway-app.up.railway.app/auth/callback`

### 2. GitHub 저장소 생성
```
저장소 이름: cp-scholarship-backend
```
이 폴더의 파일들을 업로드

### 3. Railway 배포
1. [railway.app](https://railway.app) → GitHub 로그인
2. New Project → Deploy from GitHub repo
3. cp-scholarship-backend 선택
4. 환경변수 설정 (Variables 탭):
   - GOOGLE_CLIENT_ID
   - GOOGLE_CLIENT_SECRET
   - GOOGLE_REDIRECT_URI
   - FRONTEND_URL

### 4. API 엔드포인트
- GET  `/auth/google` - OAuth 로그인 URL 발급
- GET  `/auth/callback` - OAuth 콜백
- GET  `/auth/check?session=xxx` - 세션 확인
- POST `/auth/logout` - 로그아웃
- GET  `/calendar/events?session=xxx` - 이벤트 읽기
- POST `/calendar/events` - 이벤트 추가
- PUT  `/calendar/events/:id` - 이벤트 수정
- DELETE `/calendar/events/:id` - 이벤트 삭제
