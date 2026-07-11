# CRO Audit Framework

> A production-grade, AI-powered website audit engine that evaluates any public website for **Conversion Rate Optimization (CRO)** across three modes: **SEO**, **UX/UI**, and **Full**. Returns a scored, graded report with actionable quick wins — delivered in real-time via Socket.IO and optionally emailed to the requester.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Audit Modes](#-audit-modes)
- [Architecture](#-architecture)
- [Technology Stack](#-technology-stack)
- [Engine Deep-Dive](#-engine-deep-dive)
- [Scoring System](#-scoring-system)
- [Real-Time Progress](#-real-time-progress-via-socketio)
- [API Reference](#-api-reference)
- [Lead Management](#-lead-management)
- [Email Reports](#-email-reports)
- [Frontend (Iframe Embed)](#-frontend--iframe-embed)
- [Prerequisites](#-prerequisites)
- [Setup & Running](#-setup--running)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [Development Practices](#-development-practices)
- [Preview](#-preview)

---

## 🚀 Overview

The CRO Audit Framework accepts a website URL, runs a battery of automated analysis engines in parallel, and produces a structured JSON report with:

- A **composite score** (0–100) and **letter grade** (A+ to F)
- A **human-readable label** and **context message**
- A **weighted breakdown** per dimension
- Up to 5 **quick wins** (prioritized, actionable fixes)
- Full **recommendations list** with business-value context
- **AI-generated visual ratings** (UX/UI & Full modes)
- **Core Web Vitals** details (SEO & Full modes)

All audits are **queued** through BullMQ (Redis-backed), processed by a **background worker process**, and streamed back to the client in real time via **Socket.IO**. Results are also persisted to **MongoDB** and optionally sent as a **rich HTML email report**.

---

## 🎬 Preview

https://github.com/user-attachments/assets/91eff68e-605e-4445-8378-ad71310a24b8

---

## 🎯 Audit Modes

| Mode    | Description                                                  | Engines Used                                   |
|---------|--------------------------------------------------------------|------------------------------------------------|
| `seo`   | Technical performance & navigation structure analysis        | Lighthouse (Desktop) + DOM + Score Calculator  |
| `uxui`  | Visual design, conversion flow, mobile UX & accessibility    | Lighthouse (Mobile) + DOM + Axe + Visual (AI) + Score Calculator |
| `full`  | Combined SEO + UX/UI — the most comprehensive report         | All engines                                    |

---

## 🏗 Architecture

The system is split into two independent processes that communicate through **Redis**:

```
┌─────────────────────────────────────────────────┐
│                  API Server                      │
│  (Express + Socket.IO)                           │
│                                                  │
│  POST /api/audit/run                             │
│       │                                          │
│       ├─ Create Lead (MongoDB)                   │
│       ├─ Enqueue Job (BullMQ → Redis)            │
│       └─ Return { jobId, leadId } → 202          │
│                                                  │
│  Socket.IO: client joins room(jobId)             │
│  Redis Pub/Sub: receive progress events          │
└─────────────────┬───────────────────────────────┘
                  │  Redis Queue
┌─────────────────▼───────────────────────────────┐
│              Background Worker                   │
│  (BullMQ Worker — concurrency: 1)               │
│                                                  │
│  1. LighthouseEngine  (Chrome headless)          │
│  2. [Parallel]                                   │
│     ├─ AxeEngine      (Puppeteer tab)            │
│     ├─ DomEngine      (Puppeteer tab)            │
│     └─ VisualEngine   (Puppeteer tab × 2)        │
│  3. VisualEngine.analyzeWithAI  (GPT-4o)         │
│  4. ScoreCalculator                              │
│  5. Update Lead (MongoDB)                        │
│  6. Publish complete event → Redis Pub/Sub       │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

- **One Chrome instance, multiple tabs**: Lighthouse launches Chrome and connects Puppeteer to the same process. All subsequent engines (Axe, DOM, Visual) open new browser tabs — avoiding the overhead of spinning up additional Chrome processes.
- **Per-engine timeouts**: Each engine is wrapped with `runWithTimeout()`. If an engine stalls, a graceful fallback is used and the audit continues.
- **Worker concurrency = 1**: Audits are strictly sequential at the worker level to prevent resource exhaustion from multiple concurrent Chrome/Lighthouse processes.
- **Redis Pub/Sub bridge**: The worker publishes progress events to Redis; the API server's Socket.IO layer forwards them to the connected client room. This decouples the worker and the API server and allows horizontal scaling.

---

## 🛠 Technology Stack

### Runtime & Framework
| Technology | Purpose |
|---|---|
| **Node.js** (v18+) | Runtime |
| **TypeScript** (v5.8) | Type-safe source language |
| **Express.js** (v4) | HTTP API framework |
| **Socket.IO** (v4) | Real-time bidirectional communication |

### Analysis Engines
| Technology | Purpose |
|---|---|
| **Lighthouse** (v12) | Performance, Core Web Vitals, Accessibility, SEO scoring |
| **Puppeteer** (v24) | Headless Chrome automation for DOM analysis and screenshots |
| **axe-core / @axe-core/puppeteer** (v4) | Accessibility violation detection (WCAG) |
| **OpenAI GPT-4o** | AI-powered visual heuristics from screenshots |
| **cheerio** (v1) | Fast server-side HTML parsing |
| **broken-link-checker** (v0.7) | Crawling and link validation |

### Infrastructure & Data
| Technology | Purpose |
|---|---|
| **BullMQ** (v5) | Job queue management with retries and prioritization |
| **IORedis** (v5) | Redis client for BullMQ and Pub/Sub |
| **MongoDB / Mongoose** (v9) | Persistent storage for leads and audit results |
| **Nodemailer** (v8) | Transactional email delivery (SMTP) |
| **Winston** (v3) | Structured application logging |

### Security & Validation
| Technology | Purpose |
|---|---|
| **Helmet** (v8) | HTTP security headers + Content Security Policy |
| **express-rate-limit** (v7) | API rate limiting (100 req / 15 min) |
| **xss-clean** | XSS input sanitization |
| **HPP** | HTTP parameter pollution prevention |
| **Zod** (v3) | Schema validation |

### Developer Tooling
| Technology | Purpose |
|---|---|
| **Husky** + **lint-staged** | Pre-commit hooks |
| **commitlint** | Conventional commit enforcement |
| **ESLint** + **Prettier** | Code style and linting |
| **swagger-jsdoc** + **swagger-ui-express** | Auto-generated API documentation at `/docs` |
| **nodemon** | Hot-reload development server |

---

## ⚙️ Engine Deep-Dive

### 1. Lighthouse Engine (`lighthouse.engine.ts`)

The entry point of every audit. Launches a Chrome instance via `chrome-launcher`, connects Puppeteer to it, then runs Lighthouse.

| Mode | Config | Categories Audited |
|---|---|---|
| `seo` | Desktop (1350×940, no throttle) | performance, accessibility, seo |
| `uxui` | Mobile (412×823, 4× CPU, 1.6 Mbps) | performance, accessibility |
| `full` | Desktop (composite score) | performance, accessibility, seo |

**Outputs**: `performance`, `accessibility`, `lcp`, `cls`, `tti`, `mobilePerformance`

For `full` mode, the performance score is further refined:
```
performance = lighthouse_perf×0.6 + normLCP×0.1 + normCLS×0.1 + normTTI×0.1 + normTBT×0.1
```

---

### 2. DOM Engine (`dom.engine.ts`)

Uses a Puppeteer tab (shared browser) to load the page and extract structural signals. Sets realistic browser headers to bypass bot-detection (Cloudflare, etc.).

Waits up to 5 s for JS-rendered navigation elements (React/Next.js/Vue SPAs) before proceeding.

**Analyzes via `extractStructure` + `checkLinks`:**

| Signal | What Is Checked |
|---|---|
| **Navigation** | Total nav links, top-level items, presence of About/Contact |
| **Images** | Count, `alt` attribute coverage (%) |
| **CTAs** | Count of call-to-action elements |
| **Forms** | Form count, total fields, required-field ratio |
| **Trust Signals** | HTTPS, testimonials, client logos, trust badges, contact info (phone/email/address) |
| **Conversion Signals** | Urgency text, incentive offers |
| **Error Handling** | 404 / error page detection |
| **Structure** | H1 presence, meta title, meta description |
| **Links** | Total/valid/broken/redirect counts, average click depth, orphan pages |

---

### 3. Axe Engine (`axe.engine.ts`)

Runs accessibility audits using `@axe-core/puppeteer` on a **mobile viewport** (375×812, touch-enabled).

**Violation counts by severity:**
- `critical` — weight ×10
- `serious` — weight ×5
- `moderate` — weight ×3
- `minor` — weight ×1

**Additional mobile-specific checks:**
- **Tap target audit**: Buttons / form inputs / `[role="button"]` checked against 44 px minimum (Apple HIG).
- **Horizontal overflow**: Detects elements causing horizontal scroll.
- **Text too small**: Checks `p, li, label, td, th` elements for font sizes below 12 px.

**Final accessibility score = (Lighthouse accessibility × 0.5) + (Axe score × 0.5)**

---

### 4. Visual Engine (`visual.engine.ts`)

Captures full-page screenshots in **desktop and mobile** simultaneously (parallel Puppeteer tabs), then sends them to **GPT-4o vision** for AI-powered visual heuristics.

**Screenshot optimizations:**
- Cookie banner dismissal
- Lazy-load triggering (slow scroll)
- White-gap fixing
- HEIF image polyfill
- JPEG quality: 72 (desktop) / 60 (mobile) — optimized for fast API upload

**GPT-4o rates 8 dimensions (each 1–10):**

| Dimension | What It Measures |
|---|---|
| `value_proposition_clarity` | Is the core value clear above the fold? |
| `cta_visibility` | Are CTAs prominent and well-contrasted? |
| `above_fold_clarity` | Is the hero section clutter-free? |
| `whitespace_balance` | Is spacing used effectively? |
| `design_consistency` | Consistent fonts, colors, spacing? |
| `typography_variation` | Appropriate hierarchy and contrast? |
| `cta_placement_quality` | Strategic placement at decision points? |
| `trust_visual_signals` | Badges, testimonials, social proof visible? |

Combined result: `visual_clarity_raw = ((desktopScore + mobileScore) / 2) × 10`

---

## 📊 Scoring System

All scoring is handled by `ScoreCalculator` (`score.calculator.ts`).

### SEO Score Formula

```
seoScore = (performanceScore × 0.60) + (navigationScore × 0.40)
```

Where:
- `performanceScore = lighthousePerf×0.6 + lcpScore×0.1333 + clsScore×0.1333 + ttiScore×0.1333`
- `navigationScore` — weighted deductions for broken links, oversized menus, deep click depth, orphan pages, missing HTTPS

### UX/UI Score Formula

```
uxuiScore = (visualClarity × 0.2667)
          + (conversionFlow × 0.2667)
          + (mobileExperience × 0.2000)
          + (trustCredibility × 0.1333)
          + (accessibility × 0.1333)
```

### Full Score Formula

```
overallScore = (seoScore × 0.50) + (uxuiScore × 0.50)
```

### Grading Scale

| Score | Grade | Label |
|---|---|---|
| 90–100 | A+ | Excellent |
| 80–89 | A / A- | Very Good |
| 70–79 | B+ / B | Good |
| 60–69 | B- / C+ | Average |
| 40–59 | C / D | Below Average |
| 0–39 | F | Poor |

---

## 📡 Real-Time Progress via Socket.IO

The client can track audit progress in real time by connecting to Socket.IO and joining the job room.

### Connection Flow

```javascript
// 1. Submit audit → receive jobId
const { jobId } = await fetch('/api/audit/run', { method: 'POST', body: ... }).then(r => r.json());

// 2. Connect and join room
const socket = io('http://localhost:5000');
socket.emit('join', jobId);

// 3. Listen for events
socket.on('progress', ({ progress, currentStep, mode }) => {
  console.log(`${progress}% — ${currentStep}`);
});

socket.on('complete', ({ result }) => {
  console.log('Audit complete:', result);
  socket.emit('leave', jobId);
});

socket.on('failed', ({ error }) => {
  console.error('Audit failed:', error);
});
```

### Progress Milestones

| Step | SEO % | UX/UI % | Full % |
|---|---|---|---|
| `started` | 0 | 0 | 0 |
| `lighthouse` | 30 | 20 | 15 |
| `axe` | — | 35 | 30 |
| `dom_nav` | 50 | 50 | 45 |
| `dom_seo` | 70 | 60 | 60 |
| `visual_mobile` | — | 75 | 75 |
| `visual_trust` | — | 85 | 85 |
| `scoring` | 90 | 95 | 95 |
| `complete` | 100 | 100 | 100 |

---

## 📡 API Reference

### Interactive Docs

Swagger UI is available at: `http://localhost:5000/docs`

---

### `POST /api/audit/run` — Submit Audit

Enqueues a new audit job. Returns immediately with a `202 Accepted`.

**Request Body:**

```json
{
  "url": "https://example.com",
  "mode": "full",
  "notifyViaEmail": true,
  "email": "user@example.com"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | ✅ | Target website URL (must start with `https://`) |
| `mode` | `"seo" \| "uxui" \| "full"` | ❌ | Audit mode (default: `"full"`) |
| `notifyViaEmail` | `boolean` | ❌ | Send HTML report via email on completion |
| `email` | `string` | ❌ | Recipient email address |

**Response `202`:**

```json
{
  "status": "queued",
  "message": "Audit has been added to the queue",
  "jobId": "audit_1720691234567_ab3f1",
  "customJobId": "audit_1720691234567_ab3f1",
  "leadId": "6886fa2e3c..."
}
```

---

### `GET /api/audit/status/:jobId` — Poll Job Status

**Response:**

```json
{
  "jobId": "audit_1720691234567_ab3f1",
  "status": "completed",
  "email": "user@example.com",
  "url": "https://example.com",
  "progress": 100,
  "currentStep": "complete",
  "result": { ... },
  "error": null,
  "timestamp": 1720691234567
}
```

`status` values: `waiting` | `active` | `completed` | `failed` | `delayed`

---

### `POST /api/audit/send-report` — Send Report Email

Manually trigger a report email with existing audit data.

**Request Body:**
```json
{
  "email": "user@example.com",
  "data": {
    "url": "https://example.com",
    "mode": "full",
    "score": 82,
    "grade": "A / A-",
    "label": "Very Good",
    "message": "...",
    "breakdown": { ... },
    "quickWins": [ ... ],
    "criticalIssueCount": 2
  }
}
```

---

### `GET /api/audit/emails` — List All Collected Emails

Returns all unique email addresses that have submitted audits, with their audit counts.

---

### Response — SEO Audit Mode

```json
{
  "auditMode": "seo",
  "seoScore": 79,
  "grade": "B+ / B",
  "label": "Good",
  "message": "Solid foundation with some technical gaps worth addressing.",
  "breakdown": {
    "performance": { "score": 78, "weight": 0.6, "contribution": 46.8 },
    "navigation":  { "score": 80, "weight": 0.4, "contribution": 32.0 }
  },
  "performanceDetail": {
    "lighthouseScore": 72,
    "lcp": "3.2s",
    "cls": 0.08,
    "tti": "4.1s"
  },
  "navigationDetail": {
    "brokenLinks": 3,
    "menuItems": 9,
    "avgClickDepth": 2.8,
    "orphanPages": 0
  },
  "quickWins": [
    { "issue": "Multiple broken links detected", "impact": "medium" },
    { "issue": "Navigation menu exceeds 7 items", "impact": "low" }
  ],
  "criticalIssueCount": 1,
  "metrics": {
    "bounceRate": "Average",
    "conversion": "Optimized",
    "engagement": "Average"
  },
  "recommendations": [ ... ]
}
```

---

### Response — UX/UI Audit Mode

```json
{
  "auditMode": "uxui",
  "uxuiScore": 65,
  "grade": "B- / C+",
  "label": "Average",
  "message": "Friction in your user experience is likely costing you leads and sales.",
  "breakdown": {
    "visualClarity":    { "score": 71, "weight": 0.2667, "contribution": 18.94 },
    "conversionFlow":   { "score": 60, "weight": 0.2667, "contribution": 16.0  },
    "mobileExperience": { "score": 58, "weight": 0.2,    "contribution": 11.6  },
    "trustCredibility": { "score": 60, "weight": 0.1333, "contribution": 8.0   },
    "accessibility":    { "score": 76, "weight": 0.1333, "contribution": 10.13 }
  },
  "aiRatings": {
    "value_proposition_clarity": 7,
    "cta_visibility": 8,
    "above_fold_clarity": 6,
    "whitespace_balance": 7,
    "design_consistency": 8,
    "typography_variation": 6,
    "cta_placement_quality": 7,
    "trust_visual_signals": 5
  },
  "quickWins": [
    { "issue": "Contact form has too many fields", "impact": "high" },
    { "issue": "Mobile usability issues detected", "impact": "high" },
    { "issue": "Primary CTA is not prominent enough", "impact": "high" }
  ],
  "criticalIssueCount": 3,
  "recommendations": [ ... ]
}
```

---

## 👥 Lead Management

Every audit submission automatically creates a **lead record** in MongoDB (`cro_leads` collection).

### Schema

| Field | Type | Description |
|---|---|---|
| `email` | `string` | Submitter's email |
| `websiteUrl` | `string` | Audited URL |
| `mode` | `"seo" \| "uxui" \| "full"` | Audit mode |
| `status` | `"pending" \| "completed" \| "failed"` | Job state |
| `jobId` | `string` | BullMQ job ID |
| `auditResult` | `object` | Full audit result (populated on completion) |
| `createdAt` / `updatedAt` | `Date` | Timestamps |

### Lead API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/leads` | Paginated list of all leads (`?page=1&limit=10&status=completed`) |
| `GET /api/leads/:id` | Single lead by MongoDB `_id` |
| `GET /api/leads/user/:email` | All leads for a given email (paginated) |

---

## 📧 Email Reports

When `notifyViaEmail: true` is sent with an audit request, a rich **HTML email report** is dispatched via SMTP (Nodemailer) once the audit completes.

The email template (`src/modules/audit/email/templates/audit-report.html`) includes:
- Audit score and grade
- Score breakdown table
- Top quick wins
- Recommendations list
- Key performance metrics

Email delivery is **fire-and-forget** — it never blocks the audit result from being returned.

---

## 🖼️ Frontend / Iframe Embed

The app serves a built-in frontend UI at the root path `/` that can also be embedded as an iframe.

### Standalone

```
http://localhost:5000
```

### Basic Iframe Embed

```html
<iframe src="https://your-domain.com/" width="100%" height="700" frameborder="0"></iframe>
```

### With Company Blog Configuration (`ref` param)

Use the `ref` query parameter to render company-specific blog content and a contact page link inside the iframe:

```html
<iframe src="http://localhost:5000?ref=zealousweb.com" height="700px" width="600px"></iframe>
```

**Available `ref` values:**

| Value | Displays |
|---|---|
| `zealousweb.com` | ZealousWeb blogs + contact page |
| `medgrowthengine.ai` | MedGrowth Engine blogs + contact page |

### Customizing Blog Content

Edit `src/static/domain-blogs.json`:

```json
{
  "domain.com": {
    "blogs": [
      {
        "title": "Blog Title",
        "url": "https://domain.com/blog/post",
        "image": "cv1",
        "category": "Case Study",
        "description": "Short description..."
      }
    ],
    "contactUrl": "https://domain.com/contact/"
  }
}
```

**Image options:** `cv1`, `cv2`, `cv3` (built-in canvas gradients) or external URLs (if the hosting site's CSP allows).

> **Note:** Direct access to `domain-blogs.json` from external origins is blocked server-side (403 Forbidden). Only same-origin requests are allowed.

---

## 📋 Prerequisites

- **Node.js** v18 or higher
- **Google Chrome** or **Chromium** (must be installed and discoverable on `PATH`)
- **Redis** (for BullMQ queue and Pub/Sub)
- **MongoDB** (for lead storage)
- **OpenAI API Key** (optional — required for AI visual analysis in UX/UI and Full modes)

---

## ⚙️ Setup & Running

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Development (hot-reload)

Run the API server and worker in separate terminals:

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — Background worker
npm run dev:worker
```

### 4. Production Build

```bash
npm run build     # Compile TypeScript → dist/
npm start         # Start API server
npm run start:worker  # Start background worker
```

### Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start API server with hot-reload (nodemon) |
| `npm run dev:worker` | Start background worker with hot-reload |
| `npm run build` | Clean + compile TypeScript + copy static assets |
| `npm start` | Run compiled API server |
| `npm run start:worker` | Run compiled background worker |
| `npm run lint` | Run ESLint on all TypeScript files |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format all source files with Prettier |

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
PORT=5000
NODE_ENV=development

# OpenAI (required for AI visual analysis in uxui/full modes)
OPENAI_API_KEY=your_openai_api_key_here

# Email (SMTP — required for email report delivery)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=CRO Audit <noreply@crosite.com>

# Redis (required — for BullMQ queue and Socket.IO Pub/Sub bridge)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# MongoDB (required — for lead storage and audit result persistence)
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/
MONGODB_DB_NAME=cro_audit
```

> If `OPENAI_API_KEY` is missing, the Visual Engine will fall back to neutral placeholder scores (7/10 across all dimensions) and the audit will still complete.

---

## 📁 Project Structure

```
cro-audit/
├── src/
│   ├── app.ts                        # Express app setup, middleware, routes
│   ├── server.ts                     # HTTP server + Socket.IO init + DB connect
│   ├── worker.ts                     # Standalone BullMQ worker process entry
│   │
│   ├── config/
│   │   ├── env.ts                    # Validated environment config
│   │   ├── mongodb.ts                # Mongoose connection
│   │   └── swagger.ts                # Swagger spec config
│   │
│   ├── middlewares/
│   │   ├── security.middleware.ts    # Helmet, rate-limit, xss, hpp, cors
│   │   └── error.middleware.ts       # Global error handler
│   │
│   ├── models/
│   │   └── Lead.ts                   # Mongoose Lead schema
│   │
│   ├── modules/audit/
│   │   ├── audit.service.ts          # Orchestrates all engines + cleanup
│   │   │
│   │   ├── controller/
│   │   │   └── audit.controller.ts   # Route handlers (runAudit, getStatus, etc.)
│   │   │
│   │   ├── engines/
│   │   │   ├── lighthouse.engine.ts  # Chrome Lighthouse runner
│   │   │   ├── dom.engine.ts         # Puppeteer DOM extractor
│   │   │   ├── axe.engine.ts         # axe-core accessibility auditor
│   │   │   ├── visual.engine.ts      # Screenshot + GPT-4o visual analysis
│   │   │   ├── extractStructure.ts   # HTML structure extraction helpers
│   │   │   └── checkLinks.ts         # Link crawling and validation
│   │   │
│   │   ├── queue/
│   │   │   ├── audit.queue.ts        # BullMQ Queue definition
│   │   │   └── audit.worker.ts       # BullMQ Worker + progress emitter
│   │   │
│   │   ├── scoring/
│   │   │   └── score.calculator.ts   # All scoring formulas + recommendations
│   │   │
│   │   ├── email/
│   │   │   ├── email.service.ts      # Nodemailer email service
│   │   │   ├── email.types.ts        # Email payload types
│   │   │   └── templates/
│   │   │       └── audit-report.html # HTML email template
│   │   │
│   │   └── types/                    # TypeScript type definitions
│   │
│   ├── routes/
│   │   ├── index.ts                  # Route aggregator
│   │   ├── audit.routes.ts           # /api/audit/* routes
│   │   └── lead.routes.ts            # /api/leads/* routes
│   │
│   ├── socket/
│   │   └── socketHandler.ts          # Socket.IO server + Redis Pub/Sub bridge
│   │
│   ├── static/                       # Served frontend (iframe-embeddable)
│   │   ├── index.html
│   │   ├── index.css
│   │   ├── audit.js
│   │   └── domain-blogs.json
│   │
│   └── utils/
│       ├── asyncHandler.ts           # Express async error wrapper
│       ├── appError.ts               # Custom error class
│       ├── checkLinks.ts             # Link checker utilities
│       ├── extractStructure.ts       # DOM structure extraction utilities
│       ├── visual.utils.ts           # Screenshot helpers + GPT-4o prompt builder
│       ├── logger.ts                 # Winston logger
│       └── response.ts               # Standardized response helpers
│
├── .env.example                      # Environment variable template
├── .husky/                           # Git hooks
├── .lintstagedrc.json                # Lint-staged config
├── .prettierrc                       # Prettier config
├── commitlint.config.cjs             # Commit message linting rules
├── eslint.config.mjs                 # ESLint flat config
├── tsconfig.json                     # TypeScript compiler config
└── package.json
```

---

## 🔧 Development Practices

- **Conventional Commits**: enforced via `commitlint` + `husky` pre-commit hook
- **Lint on commit**: `lint-staged` runs ESLint + Prettier on staged files before every commit
- **Strict TypeScript**: fully typed codebase with no `any` escape hatches in business logic
- **Parallel engine execution**: `Promise.all` with per-engine timeouts for maximum throughput
- **Graceful fallbacks**: every engine has a defined fallback if it times out or errors — the audit always completes
- **Chrome lifecycle management**: browser and Chrome processes are explicitly killed in `finally` blocks to prevent zombie processes
- **Nodemon ignores**: `ai_reports/`, `final_reports/`, `websites_screenshots/` directories are excluded from hot-reload triggers

---

## 📝 License

This project is proprietary.
