# WhatsApp Staff Inbox Implementation

## ✅ WEBHOOK OWNERSHIP CONFIRMATION

**PRIMARY OWNER**: Peekaboo Backend (`peekaboojor.com`)  
**WEBHOOK PATH**: `/api/whatsapp/webhook` (UNCHANGED - exactly preserved)  
**STATUS**: ✅ 100% Control Maintained

The Peekaboo backend retains full ownership and control of:
- Webhook endpoint registration
- Webhook event handling
- Message persistence
- Admin capabilities

**NO third-party platform controls webhook or event handling.**

---

## 📋 IMPLEMENTATION SUMMARY

### **April 3, 2026 Hardening Patch**

- Staff image uploads are now restricted end-to-end to `image/jpeg` and `image/png` only (frontend picker + backend MIME validation + explicit API error details).
- Inbox realtime updates now use **Server-Sent Events** via `GET /api/staff/inbox/events` instead of aggressive 8-second polling on conversations/stats/messages.
- Meta API calls for text/template/image now use timeout + retry (exponential backoff for 429/5xx) through `utils/metaApiClient.js`.
- Added structured logging utilities (`utils/logger.js`) and wired global/process-level error reporting to improve Cloud Run error visibility.
- Added rate limiting for send endpoints (`/send`, `/send-image`, `/send-template`, `/start-conversation`) to protect WhatsApp quota usage.

### **Phase 1: Database Models**

#### WhatsAppMessage Model
**Location**: `/app/backend/node-app/models/WhatsAppMessage.js`

**Key Fields**:
- `message_id` (String, unique index) - For duplicate protection
- `sender_wa_id` (String, indexed) - WhatsApp ID of sender
- `profile_name` (String) - Display name from WhatsApp
- `message_type` (Enum) - text, image, audio, video, document, location, contacts, sticker, unsupported
- `text_body` (String) - Message content or caption
- `media_url` (String) - Media file ID for non-text messages
- `direction` (Enum) - inbound, outbound
- `status` (Enum) - pending, sent, delivered, read, failed
- `platform` (Enum) - whatsapp, instagram, facebook, telegram (for future expansion)
- `timestamp` (Date, indexed) - Message timestamp from WhatsApp
- `raw_payload` (Mixed) - Full webhook payload for debugging
- `sent_by_staff_id` (ObjectId) - Staff member who sent (for outbound)
- `linked_user_id` (ObjectId) - Link to existing customer if found
- `is_read_by_staff` (Boolean, indexed) - Read status for inbox
- `is_replied` (Boolean, indexed) - Reply tracking

**Duplicate Protection**: Unique index on `message_id` ensures same message from WhatsApp is not saved twice.

**Indexes**: Compound indexes for efficient queries:
- `sender_wa_id + timestamp`
- `platform + direction + timestamp`
- `is_read_by_staff + direction`

#### QuickReply Model
**Location**: `/app/backend/node-app/models/QuickReply.js`

**Key Fields**:
- `label` (String) - Template name
- `message` (String) - Template content
- `category` (Enum) - greeting, booking, payment, inquiry, closing, other
- `platform` (Enum) - whatsapp, all
- `created_by_staff_id` (ObjectId) - Creator
- `usage_count` (Number) - Tracking popularity
- `is_active` (Boolean) - Enable/disable
- `sort_order` (Number) - Display order

---

### **Phase 2: Webhook Enhancement**

**File Modified**: `/app/backend/node-app/routes/whatsappWebhook.js`

**Changes**:
1. **Inbound Message Persistence**: 
   - Extracts all message types (text, image, audio, video, document, location, contacts, sticker)
   - Handles incomplete payloads gracefully
   - Checks for duplicate `message_id` before saving
   - Auto-links messages to existing users by matching phone formats
   - Saves full raw_payload for debugging

2. **Outbound Status Updates**:
   - Processes webhook status callbacks (sent, delivered, read, failed)
   - Updates corresponding outbound messages in database

3. **Security Maintained**:
   - Signature validation unchanged
   - Response time kept minimal (200 OK immediately)
   - Processing moved to async handler

**Webhook Path**: `/api/whatsapp/webhook` - **EXACTLY PRESERVED**

---

### **Phase 3: Outbound Message Persistence**

**File Modified**: `/app/backend/node-app/utils/whatsappBookingConfirmation.js`

**Changes**:
- Modified `postWhatsAppText` function to:
  - Parse message_id from WhatsApp API response
  - Save outbound message to database with:
    - `direction: 'outbound'`
    - `status: 'sent'`
    - `sent_by_staff_id` (if provided)
  - Handle database save errors gracefully

- **Exported `postWhatsAppText`** for reuse in staff inbox send API

---

### **Phase 4: Staff Inbox API**

**New File**: `/app/backend/node-app/routes/staffInbox.js`  
**Route Prefix**: `/api/staff/inbox/*`  
**Authentication**: Staff or Admin only (via `staffMiddleware`)

#### Endpoints

**GET /api/staff/inbox/conversations**
- Lists all unique WhatsApp contacts
- Query params: `search` (name/phone), `unread_only` (true/false), `date_from`, `date_to`
- Returns: Array of conversations with last message, unread count, message count
- Aggregates efficiently using MongoDB pipeline

**GET /api/staff/inbox/stats**
- Returns: `total_conversations`, `unread_messages`, `today_messages`
- Used for inbox dashboard badges

**GET /api/staff/inbox/messages/:wa_id**
- Returns full message history for a contact
- Query params: `limit` (default 100), `before` (pagination)
- **Side effect**: Marks all inbound messages as read
- Populated with staff sender info

**GET /api/staff/inbox/customer-profile/:wa_id**
- Auto-links WhatsApp contact to existing customer by phone
- Returns: User info, children, recent bookings (hourly/birthday), active subscriptions
- Returns `found: false` if no matching customer

**POST /api/staff/inbox/send**
- Body: `{ wa_id, message }`
- Validates non-empty message
- Sends via `postWhatsAppText` utility
- Marks conversation as replied
- Returns success/error

**GET /api/staff/inbox/quick-replies**
- Lists active quick reply templates
- Filter by platform
- Sorted by sort_order, usage_count

**POST /api/staff/inbox/quick-replies**
- Body: `{ label, message, category, platform }`
- Creates new template
- Associates with logged-in staff

**PUT /api/staff/inbox/quick-replies/:id**
- Updates existing template
- Body: `{ label, message, category, is_active }`

**DELETE /api/staff/inbox/quick-replies/:id**
- Deletes template

**POST /api/staff/inbox/quick-replies/:id/use**
- Increments usage_count when template is used

---

### **Phase 5: Frontend Staff Inbox UI**

**File Modified**: `/app/frontend/src/pages/StaffPage.js`

#### New Tab: "Inbox"
- Added to existing tab navigation
- Shows unread message count badge
- Icon: MessageSquare

#### Layout: 3-Panel Design

**Panel 1: Conversations List (Left Sidebar)**
- Search input (by name or phone)
- Unread filter toggle button
- Inbox stats badges (total conversations, unread count)
- Scrollable conversation cards showing:
  - Profile name
  - Last message preview (with direction arrow ↓↑)
  - Timestamp (localized to Arabic)
  - Unread badge
- Active conversation highlighted with border
- Manual refresh button

**Panel 2: Message Thread (Center)**
- **No Selection State**: Shows placeholder with icon
- **Active Conversation**:
  - Header: Customer name, WhatsApp ID, linked customer badges
  - Quick Replies toggle button
  - Scrollable message area with:
    - Inbound messages: Left-aligned, white background
    - Outbound messages: Right-aligned, primary color background
    - Timestamps (HH:MM format)
    - Delivery status (sent/delivered/read/failed)
    - Staff sender name for outbound
    - Media placeholders for non-text messages
  - Quick Replies dropdown (grid of template cards)
  - Reply input form:
    - Text input
    - Send button with loading spinner
    - Validates empty messages
    - Shows success/error toasts

**Panel 3: Customer Profile (Integrated in Header)**
- Shows badges when customer is linked:
  - Customer name from database
  - Number of children
- Ready for expansion with detailed sidebar

#### State Management
- Conversations list
- Selected conversation
- Messages for selected conversation
- Customer profile data
- Quick reply templates
- Loading states
- Search/filter state

#### Real-time Updates
- Polling every **8 seconds** when Inbox tab is active
- Fetches:
  - Updated conversations list
  - New messages for selected conversation
- Polling stops when tab is inactive
- Manual refresh also available

#### User Experience
- Arabic date/time formatting
- Toast notifications for send success/error
- Loading spinners during async operations
- Responsive 3-column layout (collapses on mobile)
- Smooth transitions and hover states

---

## 🔐 SECURITY MEASURES

1. **Webhook Signature Validation**: Maintained from original implementation using `META_APP_SECRET`
2. **Staff-Only Access**: All inbox routes protected by `staffMiddleware`
3. **Rate Limiting**: Existing express-rate-limit on `/api` applies to inbox routes
4. **Environment Variables**: Sensitive tokens (`WHATSAPP_ACCESS_TOKEN`) stored securely
5. **Input Validation**: Message content, wa_id, and query parameters validated
6. **Error Handling**: Comprehensive logging without exposing sensitive data

---

## 📊 DUPLICATE PROTECTION MECHANISM

**Method**: Unique Index on `message_id`

1. WhatsApp assigns unique `message_id` to each message
2. Database enforces uniqueness via index
3. Webhook handler checks for existing `message_id` before insert
4. If duplicate detected:
   - Log: `WHATSAPP_MESSAGE_DUPLICATE_SKIPPED`
   - Skip insertion
   - Return success (no error to WhatsApp)

**Benefits**:
- Prevents duplicate messages if webhook retries
- Maintains data integrity
- Efficient (index-based check, not full table scan)

---

## 🚀 FUTURE-PROOFING

### Multi-Platform Ready
- `platform` field in WhatsAppMessage model supports:
  - whatsapp (current)
  - instagram (future)
  - facebook (future)
  - telegram (future)

### UI Modularity
- Conversation list component reusable for other platforms
- Message thread supports platform-specific styling
- Quick replies filterable by platform

### Database Scalability
- Compound indexes for fast queries as data grows
- Pagination support for message history
- Aggregation pipeline for efficient conversation listing

---

## 📝 MANUAL VERIFICATION STEPS

### Prerequisites
1. WhatsApp Cloud API configured with environment variables:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_ENABLED=true`
   - `VERIFY_TOKEN`
   - `META_APP_SECRET`

2. Staff user account with role `staff` or `admin`

### Test Procedure

#### Test 1: Webhook Message Persistence
1. Send a WhatsApp message to your business number
2. Check backend logs for: `WHATSAPP_MESSAGE_PERSISTED`
3. Verify in MongoDB:
   ```bash
   mongosh peekaboo --quiet --eval "db.whatsappmessages.findOne({direction: 'inbound'}, {message_id:1, text_body:1, sender_wa_id:1})"
   ```
4. Expected: Message saved with correct data

#### Test 2: Duplicate Protection
1. Simulate webhook retry by re-sending same payload to `/api/whatsapp/webhook`
2. Check backend logs for: `WHATSAPP_MESSAGE_DUPLICATE_SKIPPED`
3. Verify in MongoDB: Only 1 document with that `message_id`

#### Test 3: Staff Inbox UI
1. Login as staff user
2. Navigate to Staff Page → Inbox tab
3. Expected: Conversations list shows the sender
4. Click on conversation
5. Expected: Message thread displays the inbound message

#### Test 4: Send Reply
1. In message thread, type a reply
2. Click Send button
3. Expected: 
   - Success toast
   - Message appears in thread (right-aligned, primary color)
   - WhatsApp user receives message
4. Check backend logs for: `WHATSAPP_OUTBOUND_MESSAGE_PERSISTED`

#### Test 5: Customer Profile Link
1. Register a user with phone matching the WhatsApp sender
2. Create a child profile for that user
3. Refresh inbox, select same conversation
4. Expected: Header shows "Customer: [name]" and "1 child" badges

#### Test 6: Quick Replies
1. Click "Quick Replies" button
2. Expected: Dropdown shows available templates (may be empty if not seeded)
3. Create a quick reply via API or manually in database
4. Refresh, click template
5. Expected: Message text populates reply input

#### Test 7: Real-time Polling
1. Open inbox
2. Send another WhatsApp message from different number
3. Wait 8 seconds
4. Expected: New conversation appears in list automatically

#### Test 8: Search and Filter
1. Search by customer name in search input
2. Expected: Conversation list filters
3. Toggle "Unread Only"
4. Expected: Only unread conversations shown

---

## 📁 FILES CHANGED

### New Files Created
1. `/app/backend/node-app/models/WhatsAppMessage.js` - Message database model
2. `/app/backend/node-app/models/QuickReply.js` - Quick reply template model
3. `/app/backend/node-app/routes/staffInbox.js` - Staff inbox API routes
4. `/app/backend/node-app/scripts/seed-quick-replies.js` - Optional seeding script

### Files Modified
1. `/app/backend/node-app/routes/whatsappWebhook.js` - Added message persistence
2. `/app/backend/node-app/utils/whatsappBookingConfirmation.js` - Added outbound persistence
3. `/app/backend/node-app/index.js` - Registered inbox routes
4. `/app/frontend/src/pages/StaffPage.js` - Added Inbox tab and full UI
5. `/app/test_result.md` - Updated with implementation details

---

## 🎯 DELIVERABLES CHECKLIST

- [x] Webhook ownership confirmed (100% Peekaboo backend)
- [x] Webhook path unchanged (`/api/whatsapp/webhook`)
- [x] Inbound message persistence with duplicate protection
- [x] Outbound message persistence
- [x] Staff inbox API (9 endpoints)
- [x] Staff inbox UI (full-featured, 3-panel layout)
- [x] Customer profile auto-linking
- [x] Quick reply template system
- [x] Real-time polling (8 seconds)
- [x] Search and filter functionality
- [x] Security measures maintained
- [x] Future-proof for multi-platform

---

## 🔧 ENVIRONMENT VARIABLES REQUIRED

All variables already configured in `/app/backend/.env`:
- `WHATSAPP_ACCESS_TOKEN` - WhatsApp Cloud API access token
- `WHATSAPP_PHONE_NUMBER_ID` - Business phone number ID
- `WHATSAPP_ENABLED` - Set to "true" to enable WhatsApp features
- `VERIFY_TOKEN` - Webhook verification token
- `META_APP_SECRET` - For webhook signature validation
- `WHATSAPP_WEBHOOK_VALIDATE_SIGNATURE` - Optional, defaults to "true"

---

## 📈 PERFORMANCE CONSIDERATIONS

1. **Database Indexing**: Compound indexes optimize conversation and message queries
2. **Pagination**: Message history endpoint supports `before` parameter for pagination
3. **Aggregation**: Conversation list uses MongoDB aggregation pipeline for efficiency
4. **Polling Interval**: 8-second polling balances real-time feel with server load
5. **Lazy Loading**: Messages loaded only when conversation is selected
6. **Auto-read Marking**: Reduces unread count queries

---

## 🐛 KNOWN LIMITATIONS & FUTURE ENHANCEMENTS

### Current Limitations
1. Media messages show placeholders (image/video/audio files not downloaded)
2. Quick replies seed script requires existing staff user
3. No pagination UI for conversations list (API supports it)
4. Customer profile limited to header badges (no detailed sidebar yet)

### Recommended Future Enhancements
1. **Media Handling**: Download and display media files from WhatsApp Cloud API
2. **Desktop Notifications**: Browser notifications for new messages
3. **Message Templates**: Support for WhatsApp Business API message templates
4. **Chat Assignment**: Assign conversations to specific staff members
5. **Message Search**: Full-text search across message content
6. **Export Conversations**: Download chat history as PDF/CSV
7. **Automated Responses**: AI-powered auto-replies for common questions
8. **Analytics Dashboard**: Message volume, response times, staff performance
9. **Instagram/Facebook Integration**: Extend to other Meta platforms
10. **WebSocket Support**: Replace polling with real-time WebSocket updates

---

## ✅ CONCLUSION

The WhatsApp Staff Inbox has been successfully implemented with **100% webhook ownership maintained by Peekaboo backend**. The system is production-ready, secure, scalable, and future-proof for additional chat platforms. All inbound and outbound messages are persisted to the database with comprehensive metadata. Staff can efficiently manage customer conversations through a modern, user-friendly interface with real-time updates.

**Ready for backend testing and deployment.**
