# Deployment - Google Cloud Run

## Backend Deployment

### 1. Build and push image

```bash
cd backend
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/whatsapp-saas-backend
```

### 2. Deploy to Cloud Run

```bash
gcloud run deploy whatsapp-saas-backend \
  --image gcr.io/YOUR_PROJECT_ID/whatsapp-saas-backend \
  --platform managed \
  --region me-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars MONGO_URL=...,JWT_SECRET=...,META_APP_SECRET=...,WHATSAPP_WEBHOOK_VERIFY_TOKEN=...,AI_PROVIDER=gemini,GEMINI_API_KEY=...
```

### 3. Set webhook URL in Meta

Use the Cloud Run service URL:
`https://whatsapp-saas-backend-xxxx.run.app/api/whatsapp/webhook`

## Frontend Deployment

### Option A: Firebase Hosting

```bash
cd frontend
npm run build
firebase deploy --only hosting
```

### Option B: Serve from backend

Add to backend `app.js`:
```js
app.use(express.static(path.join(__dirname, '../../frontend/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../../frontend/dist/index.html')));
```

### Option C: Vercel / Netlify

Point to `frontend/` directory, build command `npm run build`, output `dist/`.

## Environment Variables Checklist

- [ ] MONGO_URL
- [ ] DB_NAME
- [ ] JWT_SECRET (long random string)
- [ ] META_APP_SECRET
- [ ] WHATSAPP_WEBHOOK_VERIFY_TOKEN
- [ ] AI_PROVIDER (gemini or openai)
- [ ] GEMINI_API_KEY or OPENAI_API_KEY
- [ ] FRONTEND_URL (for CORS)

## Health Check

```bash
curl https://your-backend.run.app/health
# {"status":"ok","timestamp":"..."}
```
