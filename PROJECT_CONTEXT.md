# PROJECT CONTEXT & MASTER BLUEPRINT
### Creator Hub — Multi-User Web-Based Content Automation Platform

> **Instructions for any AI Model reading this file:**
> This document is the single source of truth for the entire **Creator Hub** project.
> Read this document completely before writing, modifying, or planning any code.
> Follow all architectural rules, security boundaries, and phased development guidelines strictly.
> Do **NOT** invent missing business logic (campaign rules, earning rates, custom channel fields, video processing scripts) until explicitly provided by the user. Keep those components modular and extensible via database JSONB fields.

---

## 1. PROJECT OVERVIEW & BUSINESS MODEL

* **Name:** Creator Hub (Content Automation Platform)
* **Objective:** A centralized, multi-user web application to manage and automate video clipping, editing, uploading, tracking, and campaign workflows for a content clipping business.
* **Core Philosophy:** **Database-first**. All data, configurations, channels, tasks, metrics, and logs live inside a central database. No standalone spreadsheets or manually maintained external sheets.
* **Target Deployment:** 100% self-hosted on a Linux VPS using free/open-source tools (Docker Compose, PostgreSQL, Redis, Next.js). No paid cloud database or serverless subscriptions required.

---

## 2. USER ROLES & ACCESS CONTROL (RBAC)

The system strictly isolates two account types:

### A. Admin
* Full visibility across all platform statistics and user activities.
* User management (create, activate/deactivate, monitor channel counts & daily changes, view earnings).
* IP/VPS pool management (add IPs, assign 1 dedicated IP/VPS per user, view assignments).
* Campaign management (create, configure parameters, toggle status, grant user access).
* Admin earnings overview (overall earnings, per-user breakdown, per-campaign totals).
* System-wide Discord alert configuration.

### B. User
* Isolated account: **Can only see and manage their own data** (`WHERE userId = session.user.id`).
* Channel management (manual add, bulk add, CSV upload, status monitoring).
* View assigned campaigns and requirements.
* Automation credentials management (YouTube session cookies for Playwright, multi-account support).
* Gemini API configuration (API key and settings for title/on-screen text generation).
* Discord webhook configuration (for user-specific error alerts).
* Run automations (Run Now vs. Schedule).
* View scheduled automation tasks and execution logs.
* Analytics dashboard (refreshed every 6 hours, latest 10 videos per channel).
* Pending tasks & Review pipeline (videos reaching campaign minimum view threshold -> requirements submission -> Ready for Review -> Approved/Rejected).
* View their own assigned VPS/IP connection credentials.

---

## 3. CORE SYSTEM MODULES & SPECIFICATIONS

### 1. Admin Dashboard
Displays real-time platform statistics:
- Total number of users
- Total channels across all users
- Total active/connected channels
- Total running automations
- Total scheduled automations
- Overall earnings & individual user earnings
- System health and recent user registrations

### 2. User Management (Admin)
- Admin can create user accounts and toggle active status.
- Shows per-user stats: total channels, channels added today, channels removed today.
- View user-specific activity, automations, and earnings.

### 3. IP / VPS Management (Admin & User Settings)
- Admin adds IP addresses with port, username, password, label, and notes.
- Passwords are encrypted at rest using AES-256-GCM.
- Exactly 1 IP is assigned to each user.
- User-level background processes (like Playwright browser automation) bind to that user's assigned IP.
- Users can view their assigned IP/VPS connection details in `Settings -> Assigned Infrastructure`. Users can never view another user's IP.

### 4. Campaign Management (Admin & User View)
- Admin creates campaigns with structured parameters, target views, and AI auto-filling.
- **Export Feature (Admin):**
  - Instant one-click export of any or all campaigns in **JSON** (complete configuration for worker/backup) or **CSV** (table summary).
  - API endpoint: `/api/admin/campaigns/export?format=json|csv`.
- **Auto-Fill from Brief (Gemini AI):**
  - Textarea to paste sponsor/client campaign brief text.
  - "Scan Brief with AI" button calls `/api/admin/campaigns/ai-parse-brief` (powered by Google Gemini 1.5 Flash) to parse and auto-fill all form fields below.

- **Detailed Campaign Fields (from Admin Screenshots):**
  1. **Section 1: Identity**
     - `Campaign Name`: Main campaign title (e.g., "FortuneJack WC").
     - `Niche`: Content niche (e.g., "gaming, crypto, sports").
     - `Status`: `Active`, `Paused`, `Disabled / Draft` dropdown.
     - `Ready to Post`: Dropdown (`No (Preview / Test mode)` vs `Yes (Ready to post)`).
     - `Subcampaign GID / Name`: Subcampaign variant or Google Sheet GID.
     - `Channel Submission Link (Whop)`: URL of the Whop submission channel/form.
  2. **Section 2: Rules & Source Material**
     - `Fix YouTube Channel Mentions`: Dropdown (`No (Keep plaintext)` vs `Yes`). If Yes, and video crosses `min_views`, system fires Discord alert: *"Your video crossed minimum views, please mention the channels in video title."*
     - `Whop Channel Name`: Submission Discord/Whop channel (e.g., `#clipping-submissions`).
     - `Enable Pending Tasks Feature`: Dropdown (`Disabled` vs `Enabled`). If Enabled, videos exceeding `min_views` show in Pending Tasks.
     - `Daily Post Limit`: Max uploads allowed per day per whop/channel (e.g., 45).
     - `Drive / YouTube Video URLs`: Comma-separated list of raw footage/video links.
     - `Specify Time Ranges for Video Downloads`: Checkbox toggle for downloading specific timestamps.
     - `Min Views Filter`: Minimum views required for eligibility (e.g., 10,000).
     - `Min Engagement Rate`: Minimum engagement/likes ratio threshold.
     - `Audio Notes`: Audio instructions (e.g., "keep original audio, remove music").
  3. **Section 3: Clipping & Timing**
     - `Clipping Strategy (Multi-Select)`:
       - **Multi-Cut:** Cuts random engaging segments based on `shortDuration` and `startOffset`.
       - **Continuous:** Slices video sequentially from `startOffset` in chunks of `shortDuration`.
       - **Smart AI:** Extracts video transcript/audio, sends to Gemini AI to select the most viral/engaging moments matching duration, returns timestamps + scripts + titles + descriptions, and editing tool cuts and saves them on VPS.
     - `Short Duration (seconds)`: Target length of each short (e.g., 25s).
     - `Start Offset (seconds)`: Initial seconds to skip from raw video (e.g., 30s).
     - `Volume Multiplier`: Audio volume/gain multiplier (e.g., 1.0).
     - `Hook Video URLs`: Drive / YouTube URLs for opening hook videos.
     - `CTA Video URLs`: Drive / YouTube URLs for Call-to-Action ending clips.
  4. **Section 4: On-Screen Text & Content AI**
     - `On-Screen Text Pool`: Permanent on-screen text overlay pool. Required on every short if specified.
     - `Use Single On-Screen Text Only`: Dropdown (`No (rotate / generate)` vs `Yes (single static)`). If Yes, only the permanent on-screen text is used. If No, additional AI-generated hooks will also be created.
     - `FTC Disclosure`: Sponsorship tag (e.g., `#ad #sponsored`) automatically appended to every short title.
     - `On-Screen Text AI Guide`: Guidelines fed to Gemini AI for generating non-permanent on-screen hooks (parsed automatically from campaign sponsor brief).
     - `On-screen Max Characters`: Maximum character limit for on-screen text overlay (e.g., 50 chars).
     - `Titles / Post Captions AI Guide`: Guidelines fed to Gemini AI for generating curiosity-gap titles (parsed from sponsor brief).
     - `Descriptions AI Guide`: Guidelines for descriptions (e.g., include channel link, 5 hashtags, and FTC disclosure).
     - `Max Title Characters`: Maximum character limit for video title (e.g., 60 chars).
     - `Predefined Description`: Fixed static description template to include in every uploaded video.
     - `Use Only Predefined Description`: Checkbox. If checked, only static description is used; if unchecked, merges predefined with AI-generated description.
     - `Links in Description`: URLs or JSON-mapped links for descriptions.
  5. **Section 5: Visual Overlay & Logo**
     - `Logo / Overlay URL`: Google Drive image link or direct URL for watermarks/branding.
     - `Overlay Position`: Dropdown (`Top Left`, `Top Center`, `Top Right`, `Bottom Left`, `Bottom Center`, `Bottom Right`).
     - `Overlay Width (%)`: Scale of the logo relative to canvas width (e.g., 60%).
  6. **Section 6: Bottom Banners (Permanent On-Screen Text)**
     - `Number of Bottom Banners`: Dropdown (`0` to `5` banners).
     - Per-Banner Settings:
       - `Banner Text`: Call-to-action text (e.g. "Click link in bio!").
       - `Banner Font`: Font family (e.g. "Montenegrin Gothic One").
       - `Text Color`: Color code or name (e.g. "white").
       - `Position Height (%)`: Offset percentage from top border (e.g. 85%).
       - `Font Size (px)`: Text pixel size (e.g. 54px).
       - `Background (color@opacity)`: Background fill (e.g. "red@0.8", "black@0.5").
       - `Styled Word Count`: Number of words to highlight at the beginning.
       - `Styled Words Color`: Color for highlighted words (e.g. "yellow").
       - `Show Only in Last Seconds`: Dropdown (`No` = entire video, `Yes` = last N seconds).
       - `Duration (Last N sec)`: Duration window for banner appearance if enabled.
  7. **Section 7: On-Screen Text Styling (AI Hooks)**
     - `On-screen text Font Name`: Font family for AI text hook.
     - `Use same font for Banners & Subtitles`: Checkbox to synchronize typography.
     - `On-screen text Color`: Primary text color (e.g. "white").
     - `On-screen text Position (Height %)`: Top offset (default 27%).
     - `On-screen text Size (px)`: Pixel size (e.g. 64px).
     - `On-screen text Background`: Background styling (e.g. "black@0.5").
     - `On-screen Styled Word Count`: Number of words to highlight.
     - `On-screen Styled Words Color`: Color for highlighted words.
     - `Use same for Speaking Word Highlight`: Checkbox.
  8. **Section 8: Video Layout & Canvas Styling**
     - `Background Style (Multi-Select)`:
       - `Split Mirror Blur`: Mirror blur upper and lower background.
       - `Vibrant Mirror Blur`: Saturated vibrant background blur.
       - `Solid White Canvas` / `Solid Black Canvas` / `Custom Color`.
       - `RGB Monitor`: Adds aesthetic monitor frame and shadow.
     - `Foreground Corner Style (Multi-Select)`:
       - `Sharp Rectangular Edges`
       - `Smooth Rounded Corners` (FFMPEG alpha mask)
       - `Soft Feathered Edges`
       - `Rounded with White Border`
       - `Rounded with Drop Shadow`
  9. **Section 9: Subtitles (Speech-to-Text / xAI Grok / Whisper)**
     - `Enable Subtitles`: `Disabled (Fallback to AI Captions)`, `Enabled (Auto-generated)`, `Disabled`.
     - `Subtitle Fonts`: e.g. "Montenegrin Gothic One".
     - `Subtitle Colors`: Font color (e.g. "white").
     - `Outline Colors`: Text stroke outline (e.g. "black").
     - `Subtitle Word Size(s)`: Size (e.g. 100).
     - `Placement Height (%)`: Vertical position (default 80%).
     - `Max Words Per Screen`: Max simultaneous words (e.g. 5 words).
     - `Speaking Word Highlight`: Karaoke-style active word color (e.g. "yellow").
     - `Subtitle Text Case`: Multi-select (`ALL UPPERCASE`, `all lowercase`, `Normal Text`).
  10. **Section 10: Admin Guidelines & Styling Presets**
      - `Admin's Guide Links`: Format `Title:https://docs.google.com/...,Title2:...` — displayed directly to users as clickable resource links in their Campaign Catalog.
      - `Use Styling Presets`: Checkbox toggle.
  11. **User Access Control:**
      - Toggle to automatically grant access to "All Active Users" or select individual users.

- **Automation Tools & Background Scripts Checklist (To be built/integrated):**
  - **Tool 1: YouTube Downloader Engine:** `yt-dlp` wrapper for downloading full videos or specific timestamp ranges.
  - **Tool 2: Google Drive Downloader:** Authenticated Google Drive client for downloading video assets, hooks, CTAs, and logo images.
  - **Tool 3: FFMPEG Video Editing & Slicing Engine:**
    - Multi-Cut and Continuous slicing modes with volume multiplier.
    - Stitches Hook + Short Clip + CTA.
    - Canvas backgrounds (Split Mirror Blur, Canvas borders, Corner rounder).
    - Watermark/Logo overlay positioned by percentage.
    - Bottom Banners engine (up to 5 banners with timed appearance `enable='between(t,...)'` and styled word colors).
  - **Tool 4: Subtitles & Transcription Engine (Whisper / Grok ASS Generator):**
    - Generates animated word-by-word karaoke ASS subtitles with outline, placement, and active speaking highlight.
  - **Tool 5: Gemini Smart AI Clipper & Metadata Generator:**
    - Viral highlights extractor from transcript, titles with FTC disclosures, descriptions, and on-screen text hooks.
  - **Tool 6: Discord Mention & Threshold Monitor:**
    - Monitors video view counts; alerts Discord if channel mentions need to be fixed upon crossing min views.
  - **Tool 7: Whop Submitter Bot:**
    - Playwright browser bot to submit approved clips into Whop submission channels automatically.

### 5. Channel Management (User)
- Users can add YouTube channels via 3 methods:
  1. Manual form
  2. Bulk text/link input
  3. CSV file upload
- **Mandatory Channel Fields:**
  1. `channelName` (Channel Name)
  2. `channelHandle` (Channels Handler / Handle, e.g. `@channel`)
  3. `niche` (Niche, e.g. Gaming, Tech, Finance, Entertainment)
  4. `clientId` (Google OAuth Client_ID)
  5. `clientSecret` (Google OAuth Client Secret, encrypted at rest with AES-256-GCM)
  6. `refreshToken` (Google OAuth Refresh Token, encrypted at rest with AES-256-GCM)
  7. `status` (Active or Not Active)
- **Mandatory Live OAuth Verification on Add Channel:**
  - When the user adds a channel (or clicks "Test Credentials"), the backend hits `https://oauth2.googleapis.com/token` with the provided `client_id`, `client_secret`, and `refresh_token` (`grant_type=refresh_token`).
  - Google strictly verifies if this refresh token was generated with that exact Client ID & Secret pair.
  - If Google rejects the token (invalid_grant, invalid_client, unauthorized_client), channel creation is **blocked** and an error is shown.
  - If Google returns an access token, channel is verified and saved safely with encrypted credentials.
- Tracks channel status (`active`, `inactive`, `error`, `pending`).
- Daily counters: channels added today, channels removed today, total active channels.

### 6. Credential Management (User)
- Handles browser automation credentials (specifically YouTube session cookies for Playwright).
- Supports multiple email accounts per user.
- Cookie session data is stored encrypted at rest (`cookies_enc` via AES-256-GCM).
- Used seamlessly by automation worker scripts.

### 7. Gemini Configuration (User)
- Stores user's Gemini API key (encrypted) and custom generation prompts.
- Powers AI-driven video title generation, on-screen text, hashtags, and clipping metadata.

### 8. Discord Webhook Notifications (Admin & User)
- **User Discord Webhook:** Used by automation workers to send instant alerts if a channel automation, upload, or browser session fails.
- **Admin Discord Webhook:** Used for system-wide failures, server health warnings, and platform events.

### 9. Automation Runner & Scheduler (User)
- **Workflow:**
  1. Select Channel(s)
  2. Select Campaign
  3. Configure run options
  4. Choose: **Run Now** or **Schedule** (one-time or cron recurrence)
- Dispatches jobs to BullMQ queues backed by Redis.
- Full execution status tracking: `queued` -> `running` -> `completed` / `failed`.

### 10. Automation Worker Engine (Pluggable Backend)
- Decoupled worker processes running via BullMQ (`workers/automation.worker.ts`).
- Designed as a plug-in orchestrator for existing scripts:
  - Video editing scripts
  - YouTube upload scripts
  - YouTube token/cookie refresh workflows
  - Submitter scripts
- Worker accepts job payload, runs the modular script, updates DB status, and triggers Discord webhook on failure.

### 11. Channel Analytics (Background Worker)
- Automated background worker (`workers/analytics.worker.ts`) runs every 6 hours.
- Fetches the latest 10 videos for every active channel.
- Records video title, view count, published timestamp, and external ID.
- Updates `video_analytics` and creates snapshot history.

### 12. Pending Tasks & Review Workflow
- Trigger: When a video's view count reaches or exceeds `campaign.min_views`, a `PendingTask` is automatically generated.
- Status Lifecycle:
  1. `pending`: Video crossed view threshold, waiting for user action.
  2. `requirements_completed`: User uploaded/provided required proof (e.g., screen recording, link).
  3. `ready_for_review`: System or user flags task ready for review.
  4. `approved` or `rejected`: Evaluated by admin/reviewer.
- Full audit history maintained in `task_status_history`.

### 13. Earnings Module
- Tracks payout records per user, campaign, and completed task.
- Statuses: `pending`, `confirmed`, `paid`.
- Detailed calculation logic is modular (`calculation_data JSONB`) until exact earning rules are defined by the user.

---

## 4. TECHNOLOGY STACK & ARCHITECTURE

| Layer | Chosen Technology | Reason & License |
|---|---|---|
| **Framework** | Next.js 14 (App Router, TypeScript) | Full-stack, SSR + API routes, robust ecosystem |
| **Styling & UI** | Tailwind CSS + Lucide Icons + shadcn/ui patterns | Clean, responsive, high-contrast admin & user UI |
| **Database** | PostgreSQL 16 | Free, rock-solid relational ACID database |
| **ORM** | Prisma ORM | Type-safe schema, automatic migrations, Prisma Studio |
| **Auth** | NextAuth.js v5 (Auth.js) | Session/JWT strategy with role-based checks |
| **Password Hashing** | bcryptjs (12 salt rounds) | Industry standard security |
| **Data Encryption** | Node.js `crypto` (AES-256-GCM) | For credentials, cookies, VPS passwords, API keys |
| **Queue / Background Jobs** | BullMQ + Redis 7 | Distributed job execution, repeatable cron schedules |
| **Containerization** | Docker & Docker Compose | One-command setup on any Ubuntu/Debian VPS |

---

## 5. DATABASE SCHEMA SUMMARY (Prisma)

Location: `prisma/schema.prisma`

### Models:
1. `User`: `id, email, passwordHash, role (admin|user), name, isActive, createdAt, updatedAt, lastLoginAt`
2. `Session`: NextAuth sessions.
3. `IpAddress`: `id, ipAddress, port, username, passwordEnc, label, notes, isAvailable, assignedTo (FK User)`
4. `Channel`: `id, userId, channelIdExt, channelName, platform, status, extraData (Json), addedAt, removedAt`
5. `Campaign`: `id, name, description, status, minViews, config (Json), createdBy`
6. `CampaignUserAccess`: Many-to-many junction between `Campaign` and `User`.
7. `Credential`: `id, userId, credentialType, label, email, cookiesEnc, extraEnc, status, lastUsedAt`
8. `GeminiConfig`: `id, userId (unique), apiKeyEnc, config (Json), isActive`
9. `DiscordConfig`: `id, userId (unique), webhookUrlEnc, label, isActive`
10. `Automation`: `id, userId, campaignId, name, runType, status, options (Json), startedAt, completedAt, errorMessage, workerJobId`
11. `AutomationChannel`: Junction table for selected channels in an automation.
12. `AutomationCredential`: Junction table for credentials used in an automation.
13. `ScheduledAutomation`: `id, userId, campaignId, name, cronExpression, scheduledTime, recurrenceType, status, options (Json)`
14. `ScheduledAutomationChannel`: Junction table for scheduled automation channels.
15. `AnalyticsSnapshot`: Periodic snapshots per user and channel.
16. `VideoAnalytic`: Latest video records (`channelId, videoIdExt, title, viewCount, extraData, lastFetchedAt`).
17. `PendingTask`: `id, userId, campaignId, channelId, videoId, viewCountAtTrigger, status, requirementsData (Json), reviewedBy, reviewedAt`
18. `TaskStatusHistory`: Audit log of all status transitions for pending tasks.
19. `Earning`: `id, userId, campaignId, taskId, amount, currency, status, calculationData (Json)`
20. `ActivityLog`: User and admin activity audit trail.

---

## 6. PROJECT DIRECTORY STRUCTURE

```
d:\Creator Hub\
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx               # Sign in page
│   ├── (admin)/
│   │   ├── layout.tsx                   # Admin sidebar layout with role check
│   │   ├── dashboard/page.tsx           # Global stats, platform health
│   │   ├── users/page.tsx               # User CRUD, channel counters
│   │   ├── ip-management/page.tsx       # IP & VPS assignments
│   │   ├── campaigns/page.tsx           # Campaign management
│   │   ├── earnings/page.tsx            # Global earnings overview
│   │   └── settings/page.tsx            # Admin Discord & platform config
│   ├── (user)/
│   │   ├── layout.tsx                   # User sidebar layout with role check
│   │   ├── dashboard/page.tsx           # Personal metrics & daily counters
│   │   ├── channels/page.tsx            # Manual, bulk & CSV channel management
│   │   ├── campaigns/page.tsx           # Available campaigns & rules
│   │   ├── credentials/page.tsx         # YouTube cookie/session management
│   │   ├── gemini/page.tsx              # Gemini API keys & content settings
│   │   ├── discord/page.tsx             # User Discord webhook for error alerts
│   │   ├── run-automation/page.tsx      # Launch automation (Now or Scheduled)
│   │   ├── scheduled/page.tsx           # Upcoming scheduled tasks
│   │   ├── analytics/page.tsx           # 6-hour video analytics view
│   │   ├── pending-tasks/page.tsx       # Threshold-crossed tasks & submissions
│   │   └── settings/page.tsx            # View assigned IP/VPS connection details
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # NextAuth authentication endpoint
│   │   └── admin/
│   │       ├── users/route.ts           # Admin user API
│   │       └── ip-addresses/route.ts    # Admin IP management API
│   ├── layout.tsx                       # Root HTML & body layout
│   ├── globals.css                      # Tailwind base & color variables
│   └── page.tsx                         # Root redirect (admin -> /admin/dashboard, user -> /dashboard)
├── components/
│   ├── auth/login-form.tsx              # Client login component
│   └── layout/sidebar.tsx               # Responsive role-aware sidebar navigation
├── lib/
│   ├── db.ts                            # Prisma client singleton
│   ├── auth.ts                          # NextAuth config with JWT credentials provider
│   ├── auth-helpers.ts                  # requireAdmin(), requireUser() guards
│   ├── encryption.ts                    # AES-256-GCM encrypt/decrypt utilities
│   ├── redis.ts                         # ioredis client instance
│   ├── queues.ts                        # BullMQ queue instances
│   ├── discord.ts                       # Discord webhook POST utility
│   └── utils.ts                         # cn() tailwind class merger
├── workers/
│   ├── analytics.worker.ts              # 6-hour channel video fetcher
│   ├── automation.worker.ts             # Video processing & automation worker
│   └── scheduler.worker.ts              # Cron job dispatcher
├── prisma/
│   ├── schema.prisma                    # Complete PostgreSQL schema
│   └── seed.ts                          # Seeds initial admin user
├── docker-compose.yml                   # Postgres + Redis + Web + Workers
├── Dockerfile                           # Multi-stage production build for Web
├── Dockerfile.worker                    # Production worker container image
├── deploy.sh                            # Automated VPS deployment script
├── .env.example                         # Environment variable template
├── middleware.ts                        # Next.js route protection middleware
└── package.json
```

---

## 7. CRITICAL CODING & ARCHITECTURAL RULES FOR AI

When modifying or expanding this project, every AI model **MUST** adhere to these rules:

1. **Strict Data Isolation:**
   - Every single user query in API routes and Server Components MUST include `WHERE userId = session.user.id`.
   - Never expose other users' channels, IP addresses, credentials, or tasks.
2. **Security & Encryption:**
   - Plaintext passwords must NEVER be saved in the database. Use `bcrypt.hash(password, 12)`.
   - Sensitive strings (`cookiesEnc`, `apiKeyEnc`, `webhookUrlEnc`, `passwordEnc`) must be encrypted using `encrypt()` from `@/lib/encryption` before saving, and decrypted using `decrypt()` only when required.
3. **Do Not Hardcode Assumptions:**
   - Campaign settings, requirements fields, channel extra metadata, and earning equations will be provided progressively by the owner. Store them in existing `JSONB` columns (`config`, `extraData`, `requirementsData`, `calculationData`).
4. **Preserve Compatibility:**
   - Keep the frontend App Router structure, Prisma schema naming conventions, and BullMQ worker queue names intact.
5. **No Hallucinated Cloud Dependencies:**
   - Do not switch the database to AWS RDS, Supabase, Firebase, or other paid services unless explicitly asked. The platform is designed to run self-hosted inside Docker on a single VPS.

---

## 8. ENVIRONMENT VARIABLES (.env)

```ini
# PostgreSQL
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/content_platform"

# NextAuth
NEXTAUTH_SECRET="use-a-strong-random-32-char-string"
NEXTAUTH_URL="http://localhost:3000"

# Redis (BullMQ)
REDIS_URL="redis://localhost:6379"

# Encryption (Must be exactly 64 hex characters = 32 bytes)
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Initial Admin Seed
ADMIN_EMAIL="admin@creatorhub.com"
ADMIN_PASSWORD="YourSecurePassword123!"
ADMIN_NAME="Super Admin"
```

---

## 9. HOW TO RUN & DEPLOY

### Local Development:
1. Start PostgreSQL and Redis (e.g., via `docker compose up -d postgres redis`).
2. Copy `.env.example` to `.env.local` and set valid values.
3. Install dependencies: `npm install`
4. Generate Prisma client: `npx prisma generate`
5. Push schema to database: `npx prisma db push`
6. Seed admin account: `npm run db:seed`
7. Start dev server: `npm dev`
8. (Optional) Run background workers: `npm run workers`

### Production VPS Deployment:
1. Clone repository on VPS.
2. Configure `.env` with production passwords and domain.
3. Make deploy script executable: `chmod +x deploy.sh`
4. Run: `./deploy.sh`
5. Docker Compose will start Postgres, Redis, the Web app on port 3000, and all BullMQ workers.

---

## 10. CURRENT DEVELOPMENT STATUS & NEXT PHASES

- [x] **Phase 1: Foundation & Scaffold** (Completed)
  - Full Next.js 14 App Router project setup.
  - Complete Prisma schema with 20 models and relations.
  - NextAuth v5 role-based authentication (Admin vs. User).
  - AES-256-GCM encryption system.
  - Role-aware sidebar and layout.
  - Admin & User dashboard views with aggregate metrics.
  - Docker Compose file with PostgreSQL, Redis, Web, and Workers.
  - Master AI Context File (`PROJECT_CONTEXT.md`).
- [x] **Phase 2: User & IP Management** (Completed)
  - Admin UI for creating users (with optional direct IP assignment).
  - Searchable Users table with status toggle (Active/Inactive), daily channel counters (added/removed today), assigned IP badges, and earnings.
  - Dedicated User detail view (`/admin/users/[id]`) with tabs for infrastructure, channels, automations, earnings, and admin password reset.
  - Dedicated VPS/IP pool management (`/admin/ip-management`) with Add IP modal, Assign/Reassign/Unassign user flow, and decrypted SSH password reveal/copy.
  - User Settings page showing dedicated assigned IP and connection details.
- [x] **Phase 3: Channel Management** (Completed)
  - Full user-isolated Channel Management interface (`/channels`).
  - Multi-tab Add Channels modal:
    1. Single channel addition (URL, handle, or channel ID).
    2. Bulk multi-line channel paste (one per line, auto-parser).
    3. CSV file upload parser with downloadable sample template (`channels_template.csv`).
  - Channel list supporting Table View and Grid Cards View.
  - Interactive status dropdown (`active`, `inactive`, `pending`, `error`).
  - Daily channel activity tracking: Total active channels, Added Today, Removed Today.
  - Soft-delete channel removal flow.
- [x] **Phase 4: Campaign Management** (Completed)
  - Admin campaign creator (`/admin/campaigns`) with Minimum Views Goal (triggers Pending Tasks), Description/Rules, and Status switcher.
  - User Access Manager: Grant campaign access to All Users or specific selected users.
  - Modular Custom Parameters builder (Key-Value pairs stored in `config JSONB`).
  - User Campaigns catalog (`/campaigns`) showing granted campaigns, guidelines, and quick automation launcher.
- [ ] **Phase 5: Credentials & Gemini Config** (Next)
  - Multi-email YouTube session cookie manager (Playwright session JSON encrypted with AES-256-GCM).
  - Gemini API key and prompt template configuration.
- [ ] **Phase 6: Discord Webhook Integration**
  - Test webhook delivery for user error alerts and admin system notifications.
- [ ] **Phase 7 & 8: Automation Engine & Scheduling**
  - Channel + campaign selection UI.
  - Run Now and Scheduled job dispatcher to BullMQ.
- [ ] **Phase 9: Channel Analytics Worker**
  - Automated 6-hour fetch of latest 10 videos per channel.
- [ ] **Phase 10: Pending Tasks & Review Pipeline**
  - Auto-detection when video view count reaches campaign threshold.
  - Proof submission interface and review approval flow.
- [ ] **Phase 11 & 12: Earnings Module & Video Scripts Hookup**
  - Connecting your existing video editing, upload, and submitter scripts into the worker.
