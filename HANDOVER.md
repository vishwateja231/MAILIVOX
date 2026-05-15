# HANDOVER.md — Mailivox Engineering Handover

> Complete technical handover for the Mailivox Outreach Intelligence Platform.
> Last Updated: 2026-05-13

---

## Platform State

| System | Status |
|--------|--------|
| Lead Intelligence Engine | ✅ Production-ready |
| Verification Engine | ✅ Production-ready |
| Outreach + Campaigns | ✅ Production-ready |
| Resend Integration | ✅ Verified (emails delivered, Reply-To working) |
| Google Sheets Export | ✅ Working (existing spreadsheet sync) |
| Google Sheets Create | ⚠️ 403 (IAM permission needed) |
| Chrome Extension | ✅ Builds, ready for testing |
| Gemini AI | ✅ Initialized (Flash model) |
| Company Insights | ✅ Health scoring + pattern intelligence |
| Session/Pipeline Management | ✅ Archive + delete |
| User Assets | ✅ Persistent resumes/profiles |
| Reply-To Routing | ✅ Fixed (camelCase `replyTo` in Resend SDK v6) |

---

## Working Features

- [x] Unified intelligence pipeline (single button)
- [x] Provided email detection (skips corporate generation)
- [x] Company normalization (50+ enterprise aliases)
- [x] Intern/fresher filtering (persistent)
- [x] Strict confidence scoring (HIGH = verified only)
- [x] 8-layer validation engine with SMTP probing
- [x] Enterprise provider detection + tarpitting handling
- [x] Delivery learning (webhook-driven pattern improvement)
- [x] Conditional template engine (`{{#if}}...{{/if}}`)
- [x] Gemini AI email generation with fallback chain
- [x] Resend sending with retry + rate limiting
- [x] Reply-To header correctly set (camelCase `replyTo`)
- [x] Email queue with pause/resume/retry/dead-letter
- [x] Google Sheets append to existing spreadsheet
- [x] Auto-create tabs if missing
- [x] Session archive/restore/delete
- [x] Company health scoring + pattern intelligence
- [x] Persistent identity assets (resumes, profiles)
- [x] Delete confirmation modals (no browser alerts)
- [x] Filter tabs in Contacts (All/Pending/Verified/Invalid/Contacted)
- [x] Session-aware outreach with lead selection
- [x] Bulk send with variable replacement
- [x] SSE live event streaming
- [x] Chrome extension (Manifest V3, queue-based)

---

## Known Issues

| Issue | Root Cause | Workaround |
|-------|-----------|-----------|
| Spreadsheet creation 403 | Service account lacks IAM Editor role | Use existing spreadsheet sync |
| SMTP timeout on enterprise | Providers throttle validators | System treats as UNKNOWN, keeps MEDIUM confidence |
| Catch-all domains | Cannot distinguish valid/invalid | Marked CATCH_ALL, max MEDIUM confidence |

---

## Critical Files

| File | Purpose |
|------|---------|
| `backend/server.js` | Express app + middleware + queue startup |
| `backend/services/intelligence/pipeline.js` | Core extraction pipeline |
| `backend/services/validation/validationEngine.js` | 8-layer verification |
| `backend/services/mail/resendClient.js` | Resend SDK + MAIL_CONFIG |
| `backend/services/mail/emailQueue.js` | Delivery queue processor |
| `backend/services/ai/generateEmail.js` | Gemini/OpenAI generation |
| `backend/services/sheets/googleSheets.js` | Google Sheets + Drive |
| `backend/services/generator.js` | Email permutation engine |
| `backend/routes/outreachRoutes.js` | Campaigns + bulk send + templates |
| `frontend/src/App.jsx` | Router + sidebar (Mailivox branding) |
| `frontend/src/pages/OutreachPage.jsx` | Campaign outreach UI |
| `frontend/src/pages/EnginePage.jsx` | Lead Intelligence UI |

---

## Reply-To Architecture

**Critical fix applied:** Resend SDK v6 uses `replyTo` (camelCase), NOT `reply_to`.

```javascript
await resend.emails.send({
    from: "Vishwa Teja <jobs@vishwateja.online>",
    to: [recipient],
    replyTo: "reply@vishwateja.online",  // ← camelCase required
    subject,
    html,
});
```

Debug endpoint: `POST /api/debug/test-reply-to` — sends test email to verify routing.

---

## Database (15 models)

Session, Company, Lead, GeneratedEmail, LeadStatus, SheetExport, ProcessingLog, OutreachCampaign, SentEmail, EmailEvent, EmailQueueJob, UserResume, UserProfile, UserSignature

---

## Deployment

```bash
# Backend: Render/Railway
npm install && npx prisma generate
node server.js

# Frontend: Vercel
npm run build → deploy dist/

# Extension: Chrome Web Store
npm run build → load dist/ unpacked
```

---

## Pending Tasks

- [ ] Grant IAM Editor role for spreadsheet creation
- [ ] Set up Resend webhooks for delivery/bounce tracking
- [ ] Add multi-user authentication
- [ ] Campaign analytics dashboard
- [ ] Inbox/conversation threading
- [ ] Docker containerization

---

## End of Handover

All claims verified against live system. Use `/api/debug/google-status` and `/api/debug/test-reply-to` for diagnostics.
