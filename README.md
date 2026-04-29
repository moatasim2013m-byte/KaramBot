# WhatsApp AI Agent SaaS

A full-stack SaaS platform for local businesses to run customer interactions through WhatsApp, powered by an AI agent and a real-time staff dashboard.

---

## Stack

- **Backend:** Node.js + Express + MongoDB + Mongoose
- **Frontend:** React + Vite + Tailwind CSS (RTL Arabic)
- **WhatsApp:** Meta WhatsApp Cloud API
- **AI:** Gemini 1.5 Flash (default) or GPT-4o-mini
- **Deployment:** Docker + Google Cloud Run ready

---

## Project Structure

```
/backend
  /src
    /models        - Mongoose schemas (Business, User, Conversation, Message, Order, Menu, Clinic)
    /routes        - Express routes (auth, whatsapp, inbox, businesses, menu, orders, staff)
    /services      - WhatsApp API client, message processor
    /ai            - Provider adapter (Gemini / OpenAI)
    /workflows     - Restaurant state machine
    /middleware    - JWT auth, role guards
    /config        - Database connection
  /scripts         - Seed script
  Dockerfile
  .env.example

/frontend
  /src
    /pages         - Login, Overview, Inbox, Orders, Menu, Settings, Staff
    /components    - DashboardLayout, common components
    /context       - AuthContext
    /utils         - Axios API client
  vite.config.js
  tailwind.config.js

/docs
  architecture.md
  whatsapp-setup.md
  restaurant-mvp-flow.md
  deployment-cloud-run.md
  future-roadmap.md
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- MongoDB Atlas (or local MongoDB)
- Meta Developer App with WhatsApp product
- Gemini API key (or OpenAI)

---

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
```

Edit `.env` and fill in all values:

```env
PORT=8080
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net
DB_NAME=whatsapp_saas
JWT_SECRET=your_long_random_secret_here
META_APP_SECRET=your_meta_app_secret
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_custom_verify_token
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

Install and run seed:

```bash
npm install
npm run seed
```

Seed output will show:
```
✅ Business created: مطعم الأصيل
✅ Categories created
✅ Menu items created
✅ Users created

Login credentials:
  Platform Admin: admin@demo.com / Admin@123
  Business Owner: owner@demo.com / Owner@123
  Staff:          staff@demo.com / Staff@123
```

Start the backend:

```bash
npm run dev      # development (nodemon)
npm start        # production
```

Backend runs on: http://localhost:8080

Health check: http://localhost:8080/health

---

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on: http://localhost:5173

Vite proxies `/api` calls to `http://localhost:8080`.

---

### 3. WhatsApp Webhook

For local development, expose your backend with [ngrok](https://ngrok.com):

```bash
ngrok http 8080
```

Then in Meta → WhatsApp → Webhooks:
- URL: `https://your-ngrok-url.ngrok-free.app/api/whatsapp/webhook`
- Verify Token: same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribe to: `messages`

---

### 4. Add Business WhatsApp Credentials

After seeding, update the demo business with real WhatsApp credentials:

```bash
# Get the business ID from seed output, then:
curl -X PATCH http://localhost:8080/api/businesses/BUSINESS_ID/token \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"wa_access_token": "your_whatsapp_access_token"}'

# Also update phone_number_id via PATCH /api/businesses/BUSINESS_ID
curl -X PATCH http://localhost:8080/api/businesses/BUSINESS_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"wa_phone_number_id": "your_phone_number_id"}'
```

Or log in as `owner@demo.com` and update via the Settings page.

---

## API Reference

### Auth
```
POST   /api/auth/login              { email, password }
POST   /api/auth/register           { name, email, password, role }  [authenticated]
GET    /api/auth/me                 [authenticated]
```

### WhatsApp Webhook
```
GET    /api/whatsapp/webhook        Meta verification challenge
POST   /api/whatsapp/webhook        Inbound messages (Meta calls this)
```

### Inbox
```
GET    /api/inbox/conversations     ?status=open&search=name&page=1
GET    /api/inbox/conversations/:id/messages
POST   /api/inbox/conversations/:id/send         { text }
POST   /api/inbox/conversations/:id/takeover
POST   /api/inbox/conversations/:id/enable-ai
POST   /api/inbox/conversations/:id/resolve
GET    /api/inbox/stats
GET    /api/inbox/updates           SSE stream
```

### Menu
```
GET    /api/menu/full               All categories with items
GET    /api/menu/categories
POST   /api/menu/categories
PATCH  /api/menu/categories/:id
DELETE /api/menu/categories/:id
GET    /api/menu/items
POST   /api/menu/items
PATCH  /api/menu/items/:id
DELETE /api/menu/items/:id
```

### Orders
```
GET    /api/orders                  ?status=confirmed&date=2025-01-01
GET    /api/orders/today
GET    /api/orders/:id
PATCH  /api/orders/:id/status       { status }
```

### Business
```
GET    /api/businesses
GET    /api/businesses/:id
POST   /api/businesses              [platform_admin]
PATCH  /api/businesses/:id
PATCH  /api/businesses/:id/token    { wa_access_token }
```

### Staff
```
GET    /api/staff
PATCH  /api/staff/:id               { active, role }
```

---

## Roles & Permissions

| Role | Access |
|------|--------|
| `platform_admin` | All businesses, all data |
| `business_owner` | Own business, can create staff |
| `manager` | Operations, can view staff |
| `staff` | Inbox, orders only |

---

## AI Workflow (Restaurant)

The restaurant AI follows a strict state machine:

```
IDLE → COLLECTING_ITEMS → ASKING_ORDER_TYPE → COLLECTING_ADDRESS → CONFIRMING_ORDER → ORDER_PLACED
```

- AI does NLP (intent + item matching) using Gemini/OpenAI
- All prices come from MongoDB — AI never invents prices
- Order only confirmed on explicit customer word (تمام, اه, نعم, yes, ok...)
- Handoff to human on keywords (مشكلة, مدير, موظف...)

---

## Deployment

See `docs/deployment-cloud-run.md` for full Cloud Run instructions.

Quick Docker build:

```bash
cd backend
docker build -t whatsapp-saas .
docker run -p 8080:8080 --env-file .env whatsapp-saas
```

---

## Demo Credentials

After running `npm run seed`:

| Role | Email | Password |
|------|-------|----------|
| Platform Admin | admin@demo.com | Admin@123 |
| Business Owner | owner@demo.com | Owner@123 |
| Staff | staff@demo.com | Staff@123 |

Demo restaurant: **مطعم الأصيل** — 6 categories, 21 Arabic menu items.
