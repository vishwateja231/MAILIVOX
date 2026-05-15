# Mailivox — AI-Powered Outreach Intelligence Platform

> Enterprise-grade lead intelligence, email discovery, SMTP verification, AI outreach automation, follow-up management, and delivery tracking — built for recruiters, job seekers, and growth teams.



---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Tech Stack](#tech-stack)
5. [Folder Structure](#folder-structure)
6. [Setup Instructions](#setup-instructions)
7. [Environment Variables](#environment-variables)
8. [Email Infrastructure](#email-infrastructure)
9. [Google Cloud Setup](#google-cloud-setup)
10. [Chrome Extension](#chrome-extension)
11. [API Documentation](#api-documentation)
12. [Email Discovery Engine](#email-discovery-engine)
13. [Validation Pipeline](#validation-pipeline)
14. [Outreach System](#outreach-system)
15. [Follow-Up Automation](#follow-up-automation)
16. [Delivery Intelligence](#delivery-intelligence)
17. [Company Insights](#company-insights)
18. [Database Schema](#database-schema)
19. [Known Issues](#known-issues)
20. [Production Recommendations](#production-recommendations)
21. [Future Roadmap](#future-roadmap)

---

## Overview

Mailivox is a full-stack outreach intelligence platform that automates the entire pipeline from raw LinkedIn data to verified, personalized recruiter emails — with delivery tracking, pattern learning, bounce protection, and Google Sheets export.

```
LinkedIn Data → Lead Intelligence → Domain Discovery → Email Generation
    → SMTP Validation → AI Outreach → Resend Delivery → Follow-Up Automation
    → Webhook Tracking → Company Pattern Learning → Google Sheets Export
```

### What It Does
- **Extracts** LinkedIn profiles from search results (via Chrome Extension or paste)
- **Discovers** company domains using multi-layer resolution (manual override, email seeds, enterprise cache, Clearbit, MX heuristics)
- **Generates** enterprise-safe email permutations (max 7-8 per lead, no junk)
- **Validates** emails via SMTP probing (non-sending, RCPT TO only)
- **Learns** company email patterns from successful deliveries
- **Sends** personalized outreach via Resend with proper Reply-To routing
- **Tracks** delivery, bounces, opens, and replies via webhooks
- **Automates** follow-ups with threading (same Gmail thread)
- **Exports** verified leads to Google Sheets

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React 19 + Vite 6)                  │
│  Dashboard │ Analytics │ Lead Intelligence │ Outreach            │
│  Contacts │ Company Insights │ Pipelines │ Sheets │ Queue        │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP / SSE
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND (Express 5 + Prisma 5)                 │
│                                                                  │
│  Intelligence Pipeline │ Domain Discovery │ Email Generator      │
│  Validation Engine │ Resend Client │ Email Queue │ Follow-Up     │
│  Webhook Handler │ Google Sheets │ Gemini AI │ Assets Manager    │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Prisma ORM
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              PostgreSQL (Supabase) — 18 models                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              CHROME EXTENSION (Manifest V3)                       │
│  Content Script → Background Queue → Backend Sync                │
└─────────────────────────────────────────────────────────────────┘
```

### Email Pipeline Flow

```
Raw Input (paste / extension)
    ↓ bulkParser (segment into profile blocks)
    ↓ profileFilter (quality scoring, junk rejection)
    ↓ intern/fresher filter (persistent toggles)
    ↓ deduplicateProfiles (exact + fuzzy)
    ↓ companyNormalizer (alias mapping, dominant inference, override)
    ↓ domainDiscovery (manual override → email seeds → cache → Clearbit → heuristic)
    ↓ generator (enterprise-safe permutations, max 7-8)
    ↓ autoValidateSession (background SMTP probing)
    ↓ Prisma persist (Company, Lead, GeneratedEmail)
    ↓ SSE stream → frontend live updates
```

---

## Features

### Lead Intelligence Engine
- Single-button pipeline: paste → parse → filter → dedupe → enrich → generate → validate
- Company normalization with 50+ enterprise aliases
- Company override + domain override inputs
- Provided email detection (skips corporate generation when email exists in input)
- Intern/fresher auto-filtering (persistent localStorage toggles)
- Quality scoring with junk rejection (LinkedIn UI noise, fragments)
- Single-name support (common in India/LinkedIn exports)
- Session-based organization with archive/delete

### Domain Discovery Engine
Multi-layer resolution with priority:
1. **Manual domain override** (user input) — VERY_HIGH confidence
2. **Extracted from pasted emails** (e.g., john.doe@apple.com → apple.com) — VERY_HIGH
3. **Local DB cache** (previously resolved) — HIGH
4. **Enterprise cache** (50+ known companies) — HIGH
5. **Clearbit API** — MEDIUM
6. **Heuristic fallback** (.com/.ai/.io/.co + MX check) — LOW

### Email Generation Engine
- Enterprise-safe patterns only: `firstname.lastname`, `firstnamelastname`, `firstinitiallastname`, `firstname_lastname`, `firstname-lastname`, `lastname.firstname`, `firstinitial.lastname`
- Max 7-8 permutations per lead (no brute-force)
- No junk: no numbered variants, no random truncations, no single-char locals
- Company pattern learning: verified patterns get HIGH confidence
- All generated emails start as PENDING — only SMTP promotes to valid

### Validation Intelligence
- 8-layer pipeline: syntax → disposable → MX → catch-all → SMTP → delivery history → bounce history → pattern match
- Auto-validation after generation (feature-flagged, runs in background)
- Enterprise provider detection (Microsoft365, Gmail, Proofpoint, Mimecast)
- Tarpitting detection (adaptive behavior for throttling providers)
- SMTP timeout = UNKNOWN (not INVALID) — doesn't penalize enterprise domains
- Parallel workers (5 concurrent, 7s timeout, 1 retry)
- Result caching (1 hour TTL)

### Outreach System
- Session-aware campaigns with lead selection
- Clean template engine: `{{first_name}}`, `{{company}}`, `{{resume_link}}`
- Production email renderer with proper HTML (paragraph spacing, clickable links, mobile-safe)
- Gemini AI email generation with tone presets (professional, aggressive, startup, enterprise, concise)
- Persistent identity assets (resumes, profiles, signatures)
- Bulk send with queue management and rate limiting
- Reply-To routing: sends from `jobs@`, replies go to `reply@`
- Email threading: follow-ups stay in same Gmail thread via In-Reply-To/References headers

### Follow-Up Automation
- Auto-schedules follow-ups after configurable delay (default 3 days)
- Respects reply detection (stops if lead replied)
- Max 2 follow-ups per lead
- Threaded delivery (same Gmail conversation)
- Bounce protection: bounced leads auto-removed from follow-up queue
- Processor runs every hour automatically

### Delivery Intelligence (Resend Webhooks)
- Dedicated webhook endpoint: `POST /api/webhooks/resend`
- Handles: sent, delivered, bounced, complained, opened, clicked
- Non-blocking async processing (responds 200 immediately)
- Bounce protection: hard bounces → remove from follow-ups, blacklist email, reduce pattern confidence
- Delivery learning: successful sends → boost pattern confidence for that domain
- Feature-flagged for safe rollout

### Company Insights
- Health scoring (0-100) based on delivery, bounces, replies, patterns
- Pattern intelligence: tracks which email formats work per company
- Session linking: see which pipelines generated contacts
- Dynamic status: Verified Pattern / Bounce Risk / No Pattern Yet
- Only shows companies with active leads (no stale records)

### Google Sheets Integration
- JWT auth with spreadsheets + drive scopes
- Auto-create tabs if missing
- Append with email deduplication
- Batch writes (500 rows/chunk) with retry
- Export history tracking
- Existing spreadsheet sync (verified working)

### Chrome Extension (Manifest V3)
- Content script extracts real profile cards from LinkedIn search pages
- Background service worker with FIFO queue (one tab at a time)
- Programmatic content script injection (handles pre-existing tabs)
- React popup UI with queue management and backend health check
- Updated 2025 LinkedIn DOM selectors with multiple fallbacks
- Anti-spam: configurable delays, retry logic, deduplication

### Persistent Identity Assets
- Resume manager: save multiple resumes with names, URLs, tags, default selection
- Professional profiles: GitHub, LinkedIn, Portfolio — persistent, auto-loaded
- Delete with confirmation modals (no browser alerts)
- Auto-inject into templates without re-entry

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 3.4, Framer Motion, Recharts, Lucide Icons, Sonner |
| Backend | Node.js, Express 5, Prisma 5.22, Zod, Helmet, express-rate-limit |
| Database | PostgreSQL via Supabase (connection pooling + direct) |
| Email | Resend SDK v6, Cloudflare Email Routing |
| AI | Google Gemini 2.0 Flash (primary), OpenAI (fallback), Template (fallback) |
| Sheets | Google Sheets API v4, Google Drive API v3, JWT auth |
| Validation | Native Node.js DNS + net (SMTP sockets), parallel workers |
| Extension | Manifest V3, Vite, React, TypeScript, chrome.storage |

---

## Folder Structure

```
mail-generator/
├── backend/
│   ├── server.js                          # Express entry + middleware + queue startup
│   ├── config/features.js                 # Feature flags
│   ├── prisma/schema.prisma               # 18-model PostgreSQL schema
│   ├── routes/
│   │   ├── parseRoutes.js                 # Intelligence pipeline + email gen + validation
│   │   ├── dataRoutes.js                  # CRUD: leads, companies, sessions, analytics
│   │   ├── exportRoutes.js                # File exports + Google Sheets
│   │   ├── outreachRoutes.js              # Campaigns, send, queue, AI, templates, conversations
│   │   ├── extensionRoutes.js             # Chrome extension payload + SSE events
│   │   ├── assetsRoutes.js                # User assets: resumes, profiles, signatures
│   │   └── webhookRoutes.js               # Resend webhooks (isolated, non-blocking)
│   └── services/
│       ├── intelligence/
│       │   ├── pipeline.js                # Unified extraction pipeline + auto-validation
│       │   ├── profileFilter.js           # Quality scoring + dedup
│       │   └── companyNormalizer.js        # Company alias + inference
│       ├── domain/
│       │   └── domainDiscovery.js         # Multi-layer domain resolution
│       ├── validation/
│       │   ├── validationEngine.js        # 8-layer SMTP verification
│       │   └── bulkValidator.js           # Parallel batch validation
│       ├── mail/
│       │   ├── resendClient.js            # Resend SDK + MAIL_CONFIG + threading
│       │   ├── emailQueue.js              # Delivery queue processor
│       │   ├── followUpProcessor.js       # Automated follow-up scheduling
│       │   └── templates.js               # Email template engine
│       ├── outreach/
│       │   └── renderEmail.js             # Production HTML email renderer
│       ├── ai/
│       │   └── generateEmail.js           # Gemini/OpenAI generation
│       ├── sheets/
│       │   └── googleSheets.js            # Google Sheets + Drive integration
│       ├── generator.js                   # Enterprise email permutation engine
│       ├── nameParser.js                  # Name decomposition
│       ├── verifier.js                    # Legacy SMTP verifier
│       ├── domainFinder.js                # Clearbit domain resolution
│       ├── patternLearner.js              # Company pattern memory
│       ├── linkedInParser.js              # Single profile parser + email detection
│       ├── bulkParser.js                  # Multi-profile text parser
│       ├── bulkProcessor.js               # Legacy SSE processor
│       ├── eventBus.js                    # SSE broadcast system
│       └── db/prismaClient.js             # Singleton Prisma client
├── frontend/
│   ├── src/
│   │   ├── App.jsx                        # Router + sidebar (Mailivox branding)
│   │   ├── api.js                         # Complete API client (all endpoints)
│   │   ├── hooks/useRealtimeEvents.js     # SSE hook with auto-reconnect
│   │   ├── pages/
│   │   │   ├── CRMDashboard.jsx           # Overview stats + charts
│   │   │   ├── AnalyticsPage.jsx          # Verification pie, company bar
│   │   │   ├── EnginePage.jsx             # Lead Intelligence (single button)
│   │   │   ├── OutreachPage.jsx           # Campaign outreach system
│   │   │   ├── LeadsPage.jsx              # Contacts table with filters
│   │   │   ├── CompaniesPage.jsx          # Company Insights (health scoring)
│   │   │   ├── SessionsPage.jsx           # Pipelines (archive/delete)
│   │   │   ├── SheetsPage.jsx             # Google Sheets sync
│   │   │   └── QueuePage.jsx              # Live extraction queue
│   │   └── index.css                      # Tailwind + theme tokens + dark theme
│   └── tailwind.config.js
├── extension/
│   ├── src/
│   │   ├── content/index.ts               # LinkedIn DOM extractor (2025 selectors)
│   │   ├── background/index.ts            # Queue manager + programmatic injection
│   │   ├── popup/Popup.tsx                # React popup UI
│   │   └── types.ts                       # Shared TypeScript types
│   ├── scripts/copy-manifest.cjs          # Post-build manifest + asset copy
│   ├── dist/                              # Built extension (load in Chrome)
│   └── package.json
├── README.md
└── HANDOVER.md
```

---

## Setup Instructions

### Prerequisites
- Node.js 18+
- PostgreSQL database (Supabase recommended)
- Resend account with verified domain
- Google Cloud service account (for Sheets export)
- Cloudflare account (for email routing)

### Quick Start

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma db push
node server.js                    # → http://localhost:3000

# Frontend
cd frontend
npm install
npm run dev                       # → http://localhost:5173

# Extension
cd extension
npm install
npm run build                     # → extension/dist/ (load in Chrome)
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | Yes | PostgreSQL connection (pooled) |
| `DIRECT_URL` | Yes | PostgreSQL direct (migrations) |
| `RESEND_API_KEY` | Yes | Resend API key |
| `MAIL_FROM` | Yes | Sender email (`jobs@vishwateja.online`) |
| `MAIL_REPLY_TO` | Yes | Reply-to email (`reply@vishwateja.online`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes* | Google service account |
| `GOOGLE_PRIVATE_KEY` | Yes* | Service account PEM key |
| `GOOGLE_PROJECT_ID` | No | Google Cloud project ID |
| `GEMINI_API_KEY` | No | Google Gemini AI key |
| `OPENAI_API_KEY` | No | OpenAI fallback key |
| `ENABLE_AUTO_VALIDATION` | No | Auto-validate after generation (default: true) |
| `ENABLE_FOLLOWUPS` | No | Follow-up processor (default: true) |
| `ENABLE_BOUNCE_PROTECTION` | No | Bounce → remove from follow-ups (default: true) |
| `VALIDATION_CONCURRENCY` | No | Parallel SMTP workers (default: 5) |
| `SMTP_TIMEOUT` | No | SMTP probe timeout ms (default: 7000) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | No | Backend URL (default: `http://localhost:3000`) |

### Extension (`extension/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | No | Backend URL (default: `http://localhost:3000`) |
| `VITE_APP_NAME` | No | App name (default: `Mailivox`) |

---

## Email Infrastructure

### Resend Setup
1. Create account at [resend.com](https://resend.com)
2. Add and verify your domain
3. Create API key → `RESEND_API_KEY`

### Cloudflare Email Routing
1. In Cloudflare dashboard → Email Routing
2. Create route: `jobs@yourdomain.com` → your inbox
3. Create route: `reply@yourdomain.com` → your inbox

### Mail Flow
```
Outbound: Vishwa Teja <jobs@vishwateja.online>  (via Resend)
Reply-To: reply@vishwateja.online               (Resend replyTo field, camelCase)
Inbound:  reply@ → Cloudflare Email Routing → Gmail inbox
```

### Threading
Follow-up emails include `In-Reply-To` and `References` headers pointing to the original Resend message ID. This makes Gmail/Outlook display follow-ups in the same thread.

---

## Google Cloud Setup

1. Create/select project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Sheets API** and **Google Drive API**
3. Create service account → download JSON key
4. Extract `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
5. Extract `private_key` → `GOOGLE_PRIVATE_KEY`
6. Share your target spreadsheet with the service account email (Editor access)

**Auth method:** JWT with object-form constructor (required for googleapis v171+):
```javascript
new google.auth.JWT({ email, key, scopes: ['spreadsheets', 'drive'] })
```

---

## Chrome Extension

### Build & Load
```bash
cd extension && npm install && npm run build
```
1. Open `chrome://extensions/` → Developer mode ON
2. Click "Load unpacked" → select `extension/dist/`
3. Pin to toolbar
4. Navigate to LinkedIn search → click "Extract Leads"

### How It Works
- Content script scrolls page, extracts profile cards using 2025 LinkedIn selectors
- Background worker queues extraction, programmatically injects content script if needed
- Sends extracted profiles to `POST /api/leads/process`
- Dashboard updates live via SSE

### Key Fix
The background worker uses `chrome.scripting.executeScript` to inject the content script programmatically — this handles tabs that were open before the extension was installed.

---

## API Documentation

### Intelligence Engine
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/run-pipeline` | Unified extraction pipeline (SSE) |
| POST | `/api/parse-linkedin` | Parse single profile |
| POST | `/api/generate-emails` | Generate emails for name+company |
| POST | `/api/validate-email` | Production validation (8-layer) |
| POST | `/api/validate-batch` | Parallel batch validation |

### Contacts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leads` | Paginated leads (search, session, company filter) |
| DELETE | `/api/leads/:id` | Delete lead (cascade) |
| POST | `/api/leads/bulk-delete` | Bulk delete |
| PATCH | `/api/leads/:id/status` | Update lead status |

### Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List sessions (`?archived=true/false`) |
| DELETE | `/api/sessions/:id` | Delete session (cascade) |
| PATCH | `/api/sessions/:id/archive` | Archive/unarchive |

### Outreach
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/outreach/send` | Send single email |
| POST | `/api/outreach/bulk-send-template` | Bulk send with template |
| POST | `/api/outreach/generate` | AI email generation |
| POST | `/api/outreach/preview` | Render template preview |
| GET | `/api/outreach/session-leads` | Leads for outreach (validated only) |
| GET | `/api/outreach/conversations` | Thread view |
| GET | `/api/outreach/history` | Campaign history |
| POST | `/api/outreach/queue/start\|pause\|resume` | Queue control |

### Follow-Ups
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/outreach/follow-ups/schedule` | Schedule follow-ups |
| POST | `/api/outreach/follow-ups/process` | Process due follow-ups |
| GET | `/api/outreach/follow-ups` | List follow-ups |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/resend` | Resend delivery events |
| GET | `/api/webhooks/status` | Webhook stats + feature flags |

### Google Sheets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/google-sheets/status` | Credential validation |
| POST | `/api/google-sheets/sync` | Export leads to sheet |
| GET | `/api/debug/google-status` | Full diagnostics |

### User Assets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets/resumes` | List saved resumes |
| POST | `/api/assets/resumes` | Add resume |
| DELETE | `/api/assets/resumes/:id` | Delete resume |
| GET | `/api/assets/defaults` | Get all default assets |

---

## Email Discovery Engine

### Generation Strategy
For "Vishwa Teja" at apple.com:
```
vishwa.teja@apple.com     [firstname.lastname]      ← most common
vishwateja@apple.com      [firstnamelastname]
vteja@apple.com           [firstinitiallastname]
v.teja@apple.com          [firstinitial.lastname]
vishwa_teja@apple.com     [firstname_lastname]
vishwa-teja@apple.com     [firstname-lastname]
teja.vishwa@apple.com     [lastname.firstname]
```

### What It Does NOT Generate
- ❌ `vt@` (random initials)
- ❌ `vish@` (truncated)
- ❌ `vishwa1@` (numbered)
- ❌ Any brute-force/spam patterns

### Provided Email Detection
If input contains `vishwateja2345@gmail.com`:
- Stored directly as `PROVIDED_EMAIL` with HIGH confidence
- Corporate generation skipped entirely

---

## Validation Pipeline

### Confidence Rules
| Level | Criteria |
|-------|----------|
| **HIGH** | SMTP confirmed (non-catch-all) OR historical delivery OR verified pattern |
| **MEDIUM** | Strong pattern + valid MX (even with SMTP timeout on enterprise providers) |
| **LOW/PENDING** | Pattern guess, not verified |
| **INVALID** | SMTP rejected, bounced, no MX |

### SMTP Behavior
- 7-second timeout (configurable)
- 1 retry with exponential backoff
- Enterprise provider detection (treats timeouts as UNKNOWN, not INVALID)
- Tarpitting detection (skips domains that repeatedly timeout)
- Non-sending: uses RCPT TO probing only, never sends actual email

---

## Outreach System

### Default Template
```
Subject: Regarding opportunities at {{company}}

Hi {{first_name}},

I came across your profile and wanted to connect regarding opportunities at {{company}}.

I'm currently exploring Software Engineering and AI-focused opportunities and would love to connect or learn more if relevant.

Resume: {{resume_link}}

Best regards,
Vishwa Teja
```

### Email Rendering
- Proper `<p>` tags with 18px margin
- 16px font size, 1.7 line-height
- Auto-linkified URLs (blue, underlined, clickable)
- Email-safe HTML table structure
- Mobile-responsive (560px max-width)
- Clean plaintext fallback

---

## Follow-Up Automation

### Flow
1. Campaign sends initial email
2. After N days (configurable), if no reply detected → follow-up scheduled
3. Follow-up sent with threading headers (same Gmail thread)
4. If reply detected → all follow-ups cancelled
5. If bounced → lead removed from all queues

### Threading
```javascript
headers: {
    'In-Reply-To': '<original_resend_id@resend.dev>',
    'References': '<original_resend_id@resend.dev>'
}
```

---

## Delivery Intelligence

### Webhook Events Handled
- `email.delivered` → mark delivered, learn pattern, update lead stage
- `email.bounced` → mark invalid, cancel follow-ups, reduce pattern confidence
- `email.complained` → same as bounce
- `email.opened` / `email.clicked` → tracked in events table

### Bounce Protection
Hard bounce automatically:
1. Marks email INVALID
2. Cancels all pending follow-ups for that lead
3. Updates lead status to BOUNCED
4. Reduces pattern confidence for that domain

---

## Company Insights

### Health Score (0-100)
- +20: learned pattern exists
- +15: verified emails exist
- +10: zero bounces
- +15: replies received
- -30: more bounces than verified

### Status Labels
- **Verified Pattern Learned** — pattern confirmed via delivery
- **Pattern Detected** — pattern found but not yet verified
- **Bounce Risk** — more bounces than verified
- **No Trusted Pattern Yet** — no intelligence available

---

## Database Schema

18 models total:

| Model | Purpose |
|-------|---------|
| Session | Extraction batch (with archive support) |
| Company | Company + domain + learned pattern |
| Lead | Extracted person |
| GeneratedEmail | Email permutation (with SMTP result, validation reason) |
| LeadStatus | Lifecycle stage + follow-up tracking |
| SheetExport | Google Sheets export history |
| ProcessingLog | System logs |
| OutreachCampaign | Campaign with template + follow-up config |
| SentEmail | Every sent email (with threading fields) |
| EmailEvent | Delivery/bounce/reply webhook events |
| EmailQueueJob | Queued emails pending send |
| FollowUp | Scheduled follow-up records |
| UserResume | Saved resume assets |
| UserProfile | Saved profile links (GitHub, LinkedIn, etc.) |
| UserSignature | Saved email signatures |

---

## Known Issues

| Issue | Status | Workaround |
|-------|--------|-----------|
| New spreadsheet creation 403 | Google IAM limitation | Use "Sync to Existing Spreadsheet" |
| SMTP timeout on enterprise | Providers throttle validators | Treated as UNKNOWN, keeps MEDIUM confidence |
| Catch-all domains | Cannot distinguish valid/invalid | Marked CATCH_ALL, max MEDIUM |
| Extension on pre-existing tabs | Content script not auto-injected | Background worker injects programmatically |

---

## Production Recommendations

- **Redis + BullMQ**: Replace in-process queues with Redis-backed workers
- **Docker**: Containerize backend + frontend
- **CI/CD**: GitHub Actions for build + deploy
- **Monitoring**: Sentry for errors, Prometheus for metrics
- **Rate limiting**: Redis-backed for distributed environments
- **Multi-user auth**: JWT/OAuth for team access
- **Inbox sync**: Capture inbound replies for conversation threading

---

## Future Roadmap

- [ ] Multi-user authentication (JWT/OAuth)
- [ ] Campaign analytics dashboard (open rate, click rate)
- [ ] Inbox sync for reply detection
- [ ] AI lead scoring based on role/company/engagement
- [ ] Auto-pagination in Chrome extension
- [ ] Resend webhook signature verification
- [ ] Redis-backed queue system (BullMQ)
- [ ] Docker containerization
- [ ] TanStack Query for frontend caching
- [ ] Virtualized tables for 10k+ leads
- [ ] Multi-workspace support
- [ ] AI-powered reply classification

---

## Security Notes

- API keys never committed to git (`.env` in `.gitignore`)
- Helmet security headers active
- Rate limiting: 120 req/min general, 10/min for email sends
- CORS configured for localhost (update for production)
- Zod validation on outreach endpoints
- Webhook processing isolated (failures don't affect sending)
- No actual emails sent during SMTP validation (RCPT TO only)

---

## License

Private project. Not licensed for redistribution.

---

*Built by Vishwa Teja — Mailivox Outreach Intelligence Platform*
