# PHASE 0 – MINIMAL INBOUND MESSAGE PERSISTENCE

## ✅ WEBHOOK OWNERSHIP CONFIRMED
- **Path**: `/api/whatsapp/webhook` - **UNCHANGED**
- **Owner**: 100% Peekaboo Backend
- **Behavior**: Verification and event handling preserved exactly

---

## 📋 FILES CHANGED

### New Files:
1. `/app/backend/node-app/models/WhatsAppMessage.js` (minimal model)

### Modified Files:
1. `/app/backend/node-app/routes/whatsappWebhook.js` (add persistence only)

---

## 📄 COMPLETE CODE

### 1. NEW FILE: `/app/backend/node-app/models/WhatsAppMessage.js`

```javascript
const mongoose = require('mongoose');

const whatsAppMessageSchema = new mongoose.Schema({
  // Unique message ID from WhatsApp (duplicate protection)
  message_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Sender WhatsApp ID (phone number)
  sender_wa_id: {
    type: String,
    required: true,
    index: true
  },
  
  // Profile name from WhatsApp
  profile_name: {
    type: String,
    default: ''
  },
  
  // Message type (text, image, audio, etc.)
  message_type: {
    type: String,
    required: true
  },
  
  // Message text content
  text_body: {
    type: String,
    default: ''
  },
  
  // Timestamp from WhatsApp
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  
  // Direction (inbound only for Phase 0)
  direction: {
    type: String,
    default: 'inbound'
  },
  
  // Raw webhook payload for debugging
  raw_payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Compound index for efficient queries by sender and time
whatsAppMessageSchema.index({ sender_wa_id: 1, timestamp: -1 });

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
```

---

### 2. MODIFIED FILE: `/app/backend/node-app/routes/whatsappWebhook.js`

**CHANGES NEEDED**:

Add at the top (line 3):
```javascript
const WhatsAppMessage = require('../models/WhatsAppMessage');
```

Add this function before the GET route (after parseChanges function):
```javascript
// Persist inbound message to database (minimal)
const persistInboundMessage = async (message, profileName) => {
  try {
    const messageId = message?.id;
    if (!messageId) {
      console.warn('WHATSAPP_MESSAGE_NO_ID');
      return;
    }
    
    // Duplicate protection - check if message already exists
    const existing = await WhatsAppMessage.findOne({ message_id: messageId });
    if (existing) {
      console.log('WHATSAPP_MESSAGE_DUPLICATE_SKIPPED', { messageId });
      return;
    }
    
    const senderWaId = message?.from;
    if (!senderWaId) {
      console.warn('WHATSAPP_MESSAGE_NO_SENDER', { messageId });
      return;
    }
    
    // Extract message content
    const messageType = message?.type || 'unsupported';
    let textBody = '';
    
    if (messageType === 'text') {
      textBody = message?.text?.body || '';
    } else if (messageType === 'image') {
      textBody = message?.image?.caption || '[Image]';
    } else if (messageType === 'audio') {
      textBody = '[Audio]';
    } else if (messageType === 'video') {
      textBody = message?.video?.caption || '[Video]';
    } else if (messageType === 'document') {
      textBody = message?.document?.filename || '[Document]';
    } else if (messageType === 'location') {
      textBody = '📍 Location';
    }
    
    // Parse timestamp from WhatsApp (Unix timestamp in seconds)
    const timestamp = message?.timestamp 
      ? new Date(parseInt(message.timestamp) * 1000)
      : new Date();
    
    // Save to database
    const newMessage = new WhatsAppMessage({
      message_id: messageId,
      sender_wa_id: senderWaId,
      profile_name: profileName || '',
      message_type: messageType,
      text_body: textBody,
      timestamp,
      direction: 'inbound',
      raw_payload: message
    });
    
    await newMessage.save();
    console.log('WHATSAPP_MESSAGE_PERSISTED', { 
      messageId, 
      senderWaId, 
      messageType
    });
  } catch (error) {
    console.error('WHATSAPP_MESSAGE_PERSIST_ERROR', {
      error: error.message,
      messageId: message?.id
    });
  }
};
```

**REPLACE the POST webhook handler's setImmediate block** (lines 98-127) with:
```javascript
  setImmediate(async () => {
    console.log('WHATSAPP_WEBHOOK_RECEIVED', {
      object: payload?.object || 'unknown',
      entryCount: Array.isArray(payload?.entry) ? payload.entry.length : 0,
      changeCount: values.length
    });

    for (const value of values) {
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const profileName = value?.contacts?.[0]?.profile?.name || '';

      // Persist inbound messages
      if (messages.length > 0) {
        console.log('WHATSAPP_WEBHOOK_MESSAGES', {
          count: messages.length,
          from: messages.map(msg => msg?.from).filter(Boolean),
          types: messages.map(msg => msg?.type).filter(Boolean)
        });
        
        for (const message of messages) {
          await persistInboundMessage(message, profileName);
        }
      }

      // Status updates - keep original logging for now
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      if (statuses.length > 0) {
        console.log('WHATSAPP_WEBHOOK_STATUSES', {
          count: statuses.length,
          statuses: statuses.map(item => item?.status).filter(Boolean),
          messageIds: statuses.map(item => item?.id).filter(Boolean)
        });
      }
    }
  });
```

---

## ✅ WHAT THIS DOES

1. **Creates WhatsAppMessage model** with minimal fields needed for persistence
2. **Adds duplicate protection** via unique index on `message_id`
3. **Persists inbound messages** when webhook POST receives them
4. **Preserves all existing functionality**:
   - Webhook verification unchanged
   - Signature validation unchanged
   - Response timing unchanged (200 OK immediately)
   - Logging unchanged
   - Booking confirmations unchanged

---

## 🧪 MANUAL VERIFICATION STEPS

### Step 1: Restart Backend
```bash
sudo supervisorctl restart backend
```

### Step 2: Check Backend Logs
```bash
tail -f /var/log/supervisor/backend.out.log | grep -E "LISTENING|WHATSAPP|error"
```

### Step 3: Send Test WhatsApp Message
Send a text message to your WhatsApp Business number from any phone.

### Step 4: Verify Webhook Received
Check logs for:
```
WHATSAPP_WEBHOOK_RECEIVED
WHATSAPP_WEBHOOK_MESSAGES
WHATSAPP_MESSAGE_PERSISTED
```

### Step 5: Verify Database Persistence
```bash
mongosh peekaboo --quiet --eval "db.whatsappmessages.findOne({}, {message_id:1, sender_wa_id:1, text_body:1, timestamp:1})"
```

**Expected Output**: Document with your message data

### Step 6: Test Duplicate Protection
Re-send the exact same webhook payload (or send another message and trigger webhook again):
```bash
# Check logs for:
WHATSAPP_MESSAGE_DUPLICATE_SKIPPED
```

```bash
# Verify only 1 copy in database:
mongosh peekaboo --quiet --eval "db.whatsappmessages.countDocuments({message_id: 'YOUR_MESSAGE_ID'})"
```

**Expected Output**: `1`

### Step 7: Verify Existing Features Unchanged
```bash
# Test webhook verification still works
curl "http://localhost:8002/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
```

**Expected Output**: `test123` (the challenge)

---

## 🔐 WEBHOOK OWNERSHIP CONFIRMATION

✅ **Webhook Path**: `/api/whatsapp/webhook` - **EXACTLY PRESERVED**  
✅ **GET Method**: Verification logic **UNCHANGED**  
✅ **POST Method**: Event handling **UNCHANGED** (only added persistence)  
✅ **Signature Validation**: **UNCHANGED**  
✅ **Response Behavior**: Still returns 200 OK immediately  
✅ **Ownership**: **100% Peekaboo Backend** - No third-party control  

---

## 🛡️ EXISTING FUNCTIONALITY PRESERVED

✅ **Booking Flow**: Unchanged  
✅ **Payment Flow**: Unchanged  
✅ **WhatsApp Notifications**: Unchanged (booking confirmations still sent)  
✅ **Admin Panel**: Unchanged  
✅ **Staff Panel**: Unchanged  
✅ **Authentication**: Unchanged  
✅ **All Public Pages**: Unchanged  

---

## 📊 DATABASE VERIFICATION QUERIES

```bash
# Count total messages
mongosh peekaboo --quiet --eval "db.whatsappmessages.countDocuments({})"

# Show last 5 messages
mongosh peekaboo --quiet --eval "db.whatsappmessages.find({}, {message_id:1, sender_wa_id:1, text_body:1, timestamp:1}).sort({timestamp: -1}).limit(5)"

# Check unique senders
mongosh peekaboo --quiet --eval "db.whatsappmessages.distinct('sender_wa_id')"

# Verify no duplicates
mongosh peekaboo --quiet --eval "db.whatsappmessages.aggregate([{$group: {_id: '$message_id', count: {$sum: 1}}}, {$match: {count: {$gt: 1}}}])"
```

**Expected for last query**: Empty array (no duplicates)

---

## 🎯 SUCCESS CRITERIA

- [x] WhatsAppMessage model created with minimal fields
- [x] Webhook POST handler persists inbound messages
- [x] Duplicate protection active (unique index on message_id)
- [x] Webhook path unchanged (`/api/whatsapp/webhook`)
- [x] All existing features preserved (bookings, payments, notifications)
- [x] No new dependencies added
- [x] MongoDB pattern consistent with existing models
- [x] Error handling prevents webhook failures

---

## 🚫 WHAT WAS NOT DONE (Intentionally)

- ❌ No UI changes
- ❌ No staff inbox
- ❌ No quick replies
- ❌ No outbound message persistence
- ❌ No API endpoints for reading messages
- ❌ No customer profile linking (can be added in Phase 1)
- ❌ No status updates (can be added in Phase 1)

**PHASE 0 COMPLETE - AWAITING APPROVAL FOR NEXT PHASE**
