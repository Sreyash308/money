# Ochre Coffee Roasters - Specialty Coffee & Slow Living

A production-grade specialty coffee roastery web application and full restaurant ordering platform crafted with semantic HTML5, modern Vanilla CSS, lightweight Vanilla JavaScript, and an Express/Node.js universal database backend.

[![Deploy with Vercel](https://vercel.com/button)](https://money-iota-woad.vercel.app)

**Live Production**: [https://money-iota-woad.vercel.app](https://money-iota-woad.vercel.app)

---

## 🔗 Live Production & Server Links

The live restaurant platform is deployed at **`https://money-iota-woad.vercel.app/`**:

| Destination | Live URL | Local URL (`npm run dev`) | Description |
| :--- | :--- | :--- | :--- |
| **Customer Menu & Ordering** | [https://money-iota-woad.vercel.app/](https://money-iota-woad.vercel.app/) | [http://localhost:8000/](http://localhost:8000/) | Live catalog, search, persistent cart & checkout |
| **Live Order Tracking** | [https://money-iota-woad.vercel.app/order.html](https://money-iota-woad.vercel.app/order.html) | [http://localhost:8000/order.html](http://localhost:8000/order.html) | Real-time status stepper (`Received` &rarr; `Ready`) |
| **Admin Management Portal** | [https://money-iota-woad.vercel.app/admin](https://money-iota-woad.vercel.app/admin) | [http://localhost:8000/admin](http://localhost:8000/admin) | Orders queue, instant availability toggle, tables |

### Default Admin Credentials
- **Email**: `owner@ochrecoffee.com`
- **Password**: Configured via `ADMIN_PASSWORD` in `.env`

### Configured Payment & Settlement
- **Destination UPI ID**: `9182916879@ybl`
- **Payment Modes**:
  - **Direct UPI (NPCI Standard)**: Dynamic QR code and mobile UPI intent deep link with server-locked amount. Honest verification status starts in `PAYMENT_PENDING` until confirmed by staff/admin. Customer can submit 12-digit UTR.
  - **Pay at Counter**: In-person Cash, Card or POS settlement.
  - **Provider-Ready Gateway**: Modular abstraction (`PaymentProvider`) ready for live Razorpay API keys without altering checkout.

---

## Brand & Design Direction

- **Aesthetic**: Minimalist European & Japanese specialty café modernism.
- **Palette**: Warm off-white (`#fbfaf8`), espresso & charcoal (`#1e1b17`), terracotta & ochre (`#b85d39`), and natural olive (`#5e6653`).
- **Typography**: Google Fonts (`Plus Jakarta Sans` for geometric headings & body, `Caveat` for warm hand-drawn accents).
- **Zero Heavy Dependencies**: Pure native web standards, optimized for performance, accessibility, and smooth 60fps micro-interactions.

---

## Key Features

### 1. Customer Ordering & Cart Experience
- **Dynamic Database-Driven Menu**: Menu categories and products loaded from `/api/menu` with zero reliance on hardcoded frontend prices.
- **Menu Search & Dietary Filters**: Real-time search bar (`🔍 Search handcrafted coffees...`) plus Vegetarian Only and Chilled Only filters.
- **Dynamic Quantity Steppers**: `[ + Add ]` button transforms into `[-] {qty} [+]` controls when added to cart.
- **Real-Time Product Availability**: Products toggled off by the restaurant owner display a styled `Currently Unavailable` badge with disabled actions.
- **Persistent Cart Drawer**: Slide-in cart on desktop and full drawer on mobile. Supports item additions, removals, quantity changes (1–20), subtotal calculations, and empty cart states.
- **Sticky Mobile Cart Pill**: Fixed bottom bar on mobile (`🛒 3 items · ₹527 -> [ View Cart ]`) that appears when items are in the cart.
- **Customer Order History ("My Orders")**: Instant access to customer's past orders stored in device session with clean "No orders yet" empty state.
- **Multi-Step Checkout Modal**:
  - **Step 1: Dining Option**: `Dine In` vs `Takeaway`.
  - **Step 2: Guest Details**: Full name, 10-digit Indian mobile number validation, special instructions.
  - **Step 3: Table Picker** (Dine In only): Interactive grid of tables loaded from `/api/tables` with capacity and occupancy indicators.
  - **Step 4: Payment Selection**: `Pay Online with UPI` vs `Pay at Counter`.
  - **Step 5: Review & Confirm**: Final itemized order breakdown and server-verified total.
  - **Single-Pass Fast Order Creation**: Instant order creation with client-side idempotency key protection.

### 2. Live Order Tracking (`/order.html`)
- Customer order confirmation receipt with unique order number (e.g. `CAF-1001`).
- Real-time status progression: `Received` &rarr; `Preparing` &rarr; `Ready` &rarr; `Completed`.
- Real UPI QR Code & [Open UPI App] deep link with honest pending status.
- Customer 12-digit UTR submission for quick staff matching.
- Empty state fallback displaying "No orders yet" when no active order exists.

### 3. Protected Admin Management Portal (`/admin`)
- **Secure Authentication**: Email and bcrypt-hashed password with 7-day JWT session cookies.
- **Live Orders Board**: Real-time incoming orders queue, sound chime alert, status advance buttons (`Accept & Prepare`, `Mark Ready`, `Complete Order`), and `Verify & Mark Paid` action for Counter and UPI orders.
- **Customer UTR Highlight**: Shows customer-submitted UPI UTR so the cashier can match with incoming bank alerts to `9182916879@ybl`.
- **Instant Availability Toggle**: Toggle any product between `AVAILABLE` and `UNAVAILABLE` with a single click.
- **Menu Editor**: Add new products, update prices, descriptions, categories, and tags.
- **Table Management**: View table capacities, add tables, and inspect real-time table occupancy.
- **Today's Operational Metrics**: Real-time revenue calculation from verified paid orders and active order counts.

### 4. Zero-Trust Security & Honest Verification Architecture
- Client prices, subtotals, and totals are completely ignored by the server.
- The backend recalculates order totals from database records.
- Orders remain `PAYMENT_PENDING` until honestly verified by staff or legitimate payment gateway.
- Idempotency key guarantees that accidental double-clicks never create duplicate orders.

---

## Local Development & Testing

### Prerequisites
- Node.js v18+ (Node.js 26 recommended for built-in native SQLite).

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
The server will automatically initialize the database schema and seed all initial cafe products, tables, and the admin user.

### 3. Run Automated Test Suite
```bash
# Run baseline E2E test suite (16 tests)
npm test

# Run security regression suite (25 tests)
npm run test:security

# Run production smoke audit (7 multi-phase tests)
npm run test:smoke

# Run all test suites
npm run test:all
```

---

## 🔒 Security Architecture & Production Hardening

### 1. Zero-Trust Server Authority
- **Pricing**: All prices, subtotals, taxes, and totals submitted by the client are strictly ignored. The server computes all financial snapshots directly from active database records.
- **Table Occupancy**: Atomic validation occurs inside an ACID transaction (`BEGIN TRANSACTION`) immediately before order insertion, preventing concurrent overbooking races.
- **Sequential Order Numbers**: Order numbering uses an atomic sequence table (`order_sequences`) rather than an unsafe `MAX(order_number) + 1` query.
- **Idempotency**: Atomic insert guarded by database unique constraint (`idempotency_key`), returning the original order on retry without duplicate payments or line items.

### 2. Authentication & Admin Session Security
- **JWT Pinning**: Strictly pinned to `HS256`, with validated `issuer` (`ochre-coffee-roasters`) and `audience` (`ochre-admin`). Tokens with unexpected algorithms (e.g. `none`) are rejected.
- **HTTP-Only Cookies**: Admin session token is stored in a secure, HTTP-only cookie (`admin_token`) with `sameSite: lax`, `path: /`, and `secure: true` in production. Sensitive JWT tokens are NEVER stored in browser `localStorage`.
- **Double-Submit CSRF**: State-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE` under `/api/admin/*`) are protected by matching `x-csrf-token` header against the `ochre_csrf` cookie, with origin/host verification.
- **Brute-Force Rate Limiting**: `POST /api/admin/login` is rate-limited to 10 attempts per 15 minutes. High-risk public endpoints (`/api/orders`, `/api/payments/submit-utr`) are throttled.

### 3. Role-Based Access Control (RBAC)
The platform enforces explicit server-side RBAC:

| Action / Resource | CASHIER | OWNER | Server Middleware Guard |
| :--- | :---: | :---: | :--- |
| View Orders Queue | ✅ | ✅ | `requireAdmin` |
| Mark Counter/UPI Paid | ✅ | ✅ | `requireAdmin` |
| Advance Order Status | ✅ | ✅ | `requireAdmin` |
| View Table Occupancy | ✅ | ✅ | `requireAdmin` |
| Toggle Product In-Stock / Sold-Out | ❌ | ✅ | `requireOwner` |
| Edit Product / Prices | ❌ | ✅ | `requireOwner` |
| Create New Product | ❌ | ✅ | `requireOwner` |
| Delete Product | ❌ | ✅ | `requireOwner` |
| Create Restaurant Table | ❌ | ✅ | `requireOwner` |
| Vacate Table (Manual Override) | ❌ | ✅ | `requireOwner` |
| Purge / Reset Order History | ❌ | ✅ | `requireOwner` + `ALLOW_PRODUCTION_ORDER_RESET` |

### 4. Direct UPI & Payment State Machine
- **Honest Verification**: Direct UPI payments start strictly in `PAYMENT_PENDING`. Customer UTR submission records the reference for staff reconciliation without claiming automated verification.
- **Duplicate UTR Prevention**: Reusing a UTR across multiple orders is rejected with `DUPLICATE_UTR` (400) via indexed database checks.
- **Razorpay HMAC Verification**: Webhook and checkout signatures use `crypto.timingSafeEqual` with buffer length validation. Webhook processing is idempotent via `webhook_events` deduplication.
- **Order State Machine**: Strict sequential legal progression (`RECEIVED` &rarr; `CONFIRMED` &rarr; `PREPARING` &rarr; `READY` &rarr; `COMPLETED`). Backward transitions (e.g., `READY` &rarr; `RECEIVED`) are rejected.

### 5. Customer Privacy & Order Enumeration Protection
- Accessing `GET /api/orders/:orderNumber` without the authentic `x-order-token` (or admin bearer token) returns a masked response (`customerName: "A***a S***a"`, `customerPhone: null`, `customerUtr: null`, `items: []`, `payment: null`, `isMasked: true`).
- Full receipt details and payment QR are restricted to callers possessing the cryptographically random `order_token`.

### 6. Audit Trail Logging
All critical actions (`ADMIN_LOGIN`, `ADMIN_LOGIN_FAILED`, `ADMIN_LOGOUT`, `ORDER_STATUS_CHANGED`, `ORDER_PAYMENT_VERIFIED`, `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_AVAILABILITY_CHANGED`, `PRODUCT_DELETED`, `TABLE_CREATED`, `TABLE_VACATED`, `ORDER_RESET`, `PAYMENT_WEBHOOK_PROCESSED`, `UTR_SUBMITTED`) are logged to the `audit_logs` table with actor, role, entity, request IP, and timestamp.

---

## 🗄️ Database Architecture & Migrations

### Dual-Engine Compatibility (SQLite & PostgreSQL)
- **Development**: Native SQLite (`data/ochre.db`) with WAL mode, foreign keys enabled, and a 5000ms busy timeout.
- **Production (Vercel / Cloud)**: PostgreSQL via `pg.Pool` with connection limits, statement timeouts, and SSL (`rejectUnauthorized: false` for managed providers like Supabase/Neon).
- **Ephemeral Storage Guard**: In production on serverless platforms, the database adapter explicitly fails startup if `DATABASE_URL` is missing, preventing silent fallback to ephemeral `/tmp/ochre.db`.

### Database Schema Tables
1. `products`: Catalog items, integer prices in INR, category foreign keys, in-stock availability flag.
2. `categories`: Menu taxonomies and display ordering.
3. `restaurant_tables`: Dine-in table capacities, labels, and active flags.
4. `orders`: Authoritative order header, totals, payment and lifecycle statuses, encrypted/unique idempotency keys, order tokens, and customer UTRs.
5. `order_items`: Historical snapshots of product names and prices at purchase time.
6. `order_sequences`: Concurrency-safe atomic counter for sequential `CAF-XXXX` order numbers.
7. `payments`: Payment records, provider references, and audit timestamps.
8. `webhook_events`: Idempotent log of processed payment provider webhooks.
9. `admin_users`: Staff accounts with bcrypt password hashes and roles (`OWNER`, `CASHIER`).
10. `audit_logs`: Append-only security audit trail.
11. `settings`: Store configuration parameters (e.g. `tax_rate_percent`).

---

## 📦 Backup & Recovery Strategy

### PostgreSQL (Production)
1. **Automated Daily Backups**: Enable automated daily snapshots in your managed database dashboard (Supabase / Neon / AWS RDS).
2. **Manual Logical Backup**:
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --file=ochre_backup_$(date +%Y%m%d).dump
   ```
3. **Restoration Procedure**:
   ```bash
   pg_restore --clean --if-exists -d "$DATABASE_URL" ochre_backup_20260908.dump
   ```

### SQLite (Development)
1. **Backup SQLite DB**:
   ```bash
   sqlite3 data/ochre.db ".backup 'data/ochre_backup_$(date +%Y%m%d).db'"
   ```

---

## 🌐 Real-Time Synchronization & Horizontal Scaling

- **Development / Single Instance**: Real-time SSE updates are broadcast via an in-memory client connection set with heartbeat ping and automatic disconnect cleanup.
- **Serverless / Multi-Instance Production**: Because serverless functions (like Vercel) have ephemeral execution contexts and cannot maintain persistent SSE connection state across lambdas, multi-instance production deployments require a Redis Pub/Sub event bus (`REDIS_URL`) or an external managed WebSocket/SSE service (e.g., Pusher, Ably, or AWS API Gateway WebSockets). Client browsers gracefully fall back to adaptive polling when SSE is unavailable.

---

## 🚀 Production Deployment Checklist

Before deploying to production (e.g. Vercel, Railway, Render, AWS):

1. **Provision PostgreSQL Database**: Obtain a production connection URI (Supabase, Neon, or Railway PostgreSQL).
2. **Configure Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=8000
   DATABASE_URL=postgres://user:password@host:port/database?sslmode=require
   APP_ORIGIN=https://your-production-domain.com
   ALLOWED_ORIGINS=https://your-production-domain.com
   ADMIN_JWT_SECRET=<32+ random characters generated via: node -e "console.log(crypto.randomBytes(32).toString('hex'))">
   ADMIN_EMAIL=owner@your-cafe.com
   ADMIN_PASSWORD=<Strong production password>
   CASHIER_EMAIL=cashier@your-cafe.com
   CASHIER_PASSWORD=<Strong cashier password>
   UPI_MERCHANT_VPA=9182916879@ybl
   UPI_MERCHANT_NAME=Ochre Coffee Roasters
   RAZORPAY_KEY_ID=rzp_live_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ALLOW_PRODUCTION_ORDER_RESET=false
   ```
3. **Run Database Seeding**: Run `npm run seed` once against the production database to create initial products and staff accounts.
4. **Configure Razorpay Webhook**: In Razorpay Dashboard &rarr; Settings &rarr; Webhooks, point to `https://your-domain.com/api/payments/razorpay/webhook` with secret matching `RAZORPAY_WEBHOOK_SECRET`.
5. **Verify Health Endpoints**:
   - `GET /api/health` &rarr; `{ "status": "ok" }`
   - `GET /api/health/ready` &rarr; `{ "status": "ready", "database": "connected" }`

