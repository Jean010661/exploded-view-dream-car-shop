# Exploded View Vehicle Shop

Responsive storefront using the nine original uploaded technical diagram images. All diagrams display with `object-fit: contain` (no cropping). The app includes a cart and server-side Stripe Checkout session creation with US-only shipping address collection.

## Setup

1. Install Node.js 18+.
2. Run `npm install` from this folder.
3. Copy `.env.example` to `.env` and set `STRIPE_SECRET_KEY` to your own Stripe secret key. Never place secret keys in client HTML.
4. For production, set `PUBLIC_BASE_URL` to your deployed HTTPS domain. Run `npm start` (default port 3000).
5. Test Stripe Checkout with Stripe test-mode keys/cards before enabling live mode.

**Prices:** T-Shirt $29.99; 8×10-inch unframed matte poster $19.99. The server enforces prices and validates design, size and quantity; it does not trust cart prices supplied by the browser. Stripe line items include the design, shirt/poster format, and selected shirt size. Stripe Checkout collects US shipping addresses and card payment.

**Important before taking real orders:** Configure actual shipping fees/rates and tax handling in Stripe and the Checkout session as appropriate; arrange your print-on-demand fulfillment provider; implement and verify a Stripe `checkout.session.completed` webhook for paid-order fulfillment, order tracking, customer support, and refunds. The example does not automatically fulfill or print orders and does not constitute a connected live Stripe account. For a commercial store, also publish Terms, Privacy Policy, return policy and contact information, and verify the right to sell reproductions of vehicle artwork and brands.

### Local preview

Run `npm install && npm start`, then open `http://localhost:3000`. Without Stripe credentials, browsing/cart work but card checkout is deliberately disabled at the server.
