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
- **Password**: `ochreAdmin2026!`

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
npm test
```
Executes all 16 automated end-to-end integration and security test cases.

---

## Environment Configuration (`.env`)

See `.env.example` for all configurable variables:

```env
PORT=8000
NODE_ENV=development
DATABASE_URL=

# Razorpay Credentials (from https://dashboard.razorpay.com)
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourKeySecretHere
RAZORPAY_WEBHOOK_SECRET=YourWebhookSecretHere

# Destination UPI ID for Merchant Settlements
UPI_MERCHANT_VPA=9182916879@ybl

# Admin Authentication
ADMIN_JWT_SECRET=super-secret-jwt-key-ochre-coffee-roasters-2026
ADMIN_EMAIL=owner@ochrecoffee.com
ADMIN_PASSWORD=ochreAdmin2026!
```

---

## Vercel Deployment Guide

1. Push code to your GitHub repository.
2. In your [Vercel Dashboard](https://vercel.com), import the repository.
3. Configure your production environment variables:
   - `DATABASE_URL`: PostgreSQL connection string (Supabase / Neon / Vercel Postgres).
   - `RAZORPAY_KEY_ID`: Live Razorpay Key ID (`rzp_live_...`).
   - `RAZORPAY_KEY_SECRET`: Live Razorpay Key Secret.
   - `RAZORPAY_WEBHOOK_SECRET`: Secret string configured in Razorpay Webhooks.
   - `UPI_MERCHANT_VPA`: `9182916879@ybl`.
   - `ADMIN_JWT_SECRET`: Random 32+ character secret string.
   - `ADMIN_EMAIL`: Your admin email.
   - `ADMIN_PASSWORD`: Your chosen admin password.
4. Deploy. Vercel will route all requests via `vercel.json`.
