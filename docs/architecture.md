# Architecture Overview

## System Design

```
Customer (WhatsApp) ──► Meta Cloud API ──► Webhook (POST /api/whatsapp/webhook)
                                                      │
                                              Message Processor
                                                      │
                                         ┌────────────┴─────────────┐
                                         │                           │
                                  Workflow Engine              Save to DB
                               (restaurant.js)           (Conversation, Message)
                                         │
                                    AI Provider
                                (Gemini / OpenAI)
                                         │
                                  Reply via Meta API
                                         │
                              ◄── Customer sees reply
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS (RTL Arabic) |
| Backend | Node.js + Express |
| Database | MongoDB + Mongoose |
| Auth | JWT (7-day expiry) |
| WhatsApp | Meta WhatsApp Cloud API v19 |
| AI | Gemini 1.5 Flash (default) / GPT-4o-mini |
| Deployment | Google Cloud Run (Docker) |

## Multi-Tenancy

- Every resource (Conversation, Message, Order, MenuItem, Category) has `business_id`
- All queries are scoped to `business_id` from the authenticated user
- `platform_admin` can access all businesses
- `business_owner`, `manager`, `staff` only access their own business

## Workflow Engine

State machine for restaurant order flow:

```
IDLE → BROWSING → COLLECTING_ITEMS → ASKING_ORDER_TYPE → COLLECTING_ADDRESS → CONFIRMING_ORDER → ORDER_PLACED
```

Key principle: AI is used for NLP only. Prices and totals come exclusively from DB.

## Security

- Webhook signature validation (HMAC-SHA256)
- JWT auth on all private routes
- `business_id` isolation enforced at middleware level
- `wa_access_token` has `select: false` on schema (not returned in queries)
- Rate limiting on auth (20 req/15min) and API (100 req/min)
