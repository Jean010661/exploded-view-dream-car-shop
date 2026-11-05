/*
 * Exploded View Vehicle Shop — server.js, patched copy (Nov 2, 2026)
 *
 * Based on the ChatGPT ZIP "exploded-view-vehicle-shop_25_lvt3.zip".
 * Verification found TWO of Jean's decisions missing from the ZIP's code:
 *   1) $7.99 flat US shipping was NOT implemented (the Stripe session had no
 *      shipping_options, so customers would be charged $0 for shipping and
 *      Jean would eat the shipping cost on every order).
 *   2) Order-notification emails to jeanv@unitedaigroup.com were NOT
 *      implemented (no Stripe webhook at all — orders would only show up in
 *      the Stripe Dashboard, with no email to Jean).
 * This copy fixes both. To use it: replace server.js in the project folder
 * with this file before deploying to Render.
 *
 * EXTRA SETUP NEEDED (Jean's steps):
 *   a) npm install nodemailer   (new dependency, added below in package.json)
 *   b) In the .env file add:
 *        STRIPE_WEBHOOK_SECRET=whsec_...   (from Stripe Dashboard > Developers > Webhooks)
 *        SMTP_HOST=smtp.gmail.com
 *        SMTP_PORT=587
 *        SMTP_USER=jeanv@unitedaigroup.com
 *        SMTP_PASS=<a Google app password from Bitwarden, NOT the login password>
 *      (Or point SMTP_HOST/USER/PASS at his own mail server if he prefers.)
 *   c) In Stripe Dashboard > Developers > Webhooks, create an endpoint:
 *        https://YOUR-DOMAIN.onrender.com/api/webhook
 *      listening for the event "checkout.session.completed".
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const app = express();

// NOTE: the webhook route below needs the RAW body, so we register it BEFORE
// express.json(). Everything else uses JSON parsing.
const stripe = () => Stripe(process.env.STRIPE_SECRET_KEY);

const products = [
  'Ducati Panigale V4 Exploded',
  'Harley-Davidson Street Glide Exploded',
  'Ford F-150 Exploded',
  'Yangwang U8L Luxury SUV Exploded',
  'BMW 330i Exploded',
  'Maserati GranTurismo Exploded',
  'Lamborghini Temerario Exploded',
  'Corvette Stingray Exploded',
  'Luxury Yacht Exploded'
];
const sizes = new Set(['S','M','L','XL']);

// --- Order notification email setup ------------------------------------
// Sends a plain order summary to jeanv@unitedaigroup.com whenever Stripe
// reports a completed checkout. If the SMTP settings are missing, it logs
// the order to the server console instead of crashing.
function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature check failed:', err.message);
    return res.status(400).send('Bad signature');
  }
  // Answer Stripe immediately; the email work below runs after the response is sent.
  res.json({ received: true });
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const full = await stripe().checkout.sessions.retrieve(session.id, { expand: ['line_items', 'customer_details'] });
      const lines = (full.line_items && full.line_items.data || [])
        .map((li) => `${li.quantity} x ${li.description} — $${(li.amount_total / 100).toFixed(2)}`)
        .join('\n');
      const c = full.customer_details || {};
      const body =
        `New Exploded View Vehicle Shop order!\n\n` +
        `Items:\n${lines}\n\n` +
        `Total paid: $${(full.amount_total / 100).toFixed(2)} (includes $${((full.total_details && full.total_details.amount_shipping) || 0) / 100} shipping)\n` +
        `Customer: ${c.name || ''} <${c.email || ''}>  Phone: ${c.phone || ''}\n` +
        `Ship to: ${(c.address && [c.address.line1, c.address.line2, c.address.city, c.address.state, c.address.postal_code].filter(Boolean).join(', ')) || ''}\n` +
        `Stripe session: ${session.id}\n`;
      if (process.env.RESEND_API_KEY) {
        // Resend HTTPS API (works on hosts that block outbound SMTP, e.g. Render free tier)
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type': 'application/json',
            'User-Agent': 'exploded-view-shop/1.0',
          },
          body: JSON.stringify({
            from: 'onboarding@resend.dev',
            to: 'jvitalbc@gmail.com',
            subject: `New t-shirt shop order — $${(full.amount_total / 100).toFixed(2)}`,
            text: body,
          }),
        });
        const respText = await resp.text();
        if (!resp.ok) {
          throw new Error('Resend email failed: ' + resp.status + ' ' + respText);
        }
        let resendId = '';
        try { resendId = JSON.parse(respText).id; } catch (e) { /* ignore */ }
        console.log('Order email sent to jvitalbc@gmail.com for session', session.id, resendId);
      } else {
        // Fallback for local use: Gmail SMTP via nodemailer
        const transport = mailer();
        if (transport) {
          await transport.sendMail({
            from: process.env.SMTP_USER,
            to: 'jeanv@unitedaigroup.com',
            subject: `New t-shirt shop order — $${(full.amount_total / 100).toFixed(2)}`,
            text: body,
          });
          console.log('Order email sent to jeanv@unitedaigroup.com for session', session.id);
        } else {
          console.log('SMTP not configured — order would have been emailed:\n' + body);
        }
      }
    } catch (err) {
      console.error('Order webhook processing failed:', err.message);
    }
  }
});
// --- End webhook --------------------------------------------------------

app.use(express.json({limit:'15kb'}));
app.use(express.static(path.join(__dirname,'public')));

// --- Custom design request (not an order) -------------------------------
app.post('/api/request-design', async (req, res) => {
  try {
    const b = req.body || {};
    // Honeypot: real visitors never fill this in. Quietly pretend success.
    if (typeof b.website === 'string' && b.website.trim() !== '') return res.json({ ok: true });
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const year = str(b.year), make = str(b.make), model = str(b.model);
    const format = str(b.format), name = str(b.name), email = str(b.email);
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2030) return res.status(400).json({ error: 'Year must be 4 digits between 1900 and 2030.' });
    if (!make || make.length > 100) return res.status(400).json({ error: 'Make is required.' });
    if (!model || model.length > 100) return res.status(400).json({ error: 'Model is required.' });
    if (format !== 'shirt' && format !== 'poster') return res.status(400).json({ error: 'Format must be shirt or poster.' });
    if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required.' });
    if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    const formatLabel = format === 'shirt' ? 'T-Shirt $29.99' : '8x10 Poster $19.99';
    if (process.env.RESEND_API_KEY) {
      const text =
        `Year: ${year}\n` +
        `Make: ${make}\n` +
        `Model: ${model}\n` +
        `Format: ${formatLabel}\n` +
        `Customer name: ${name}\n` +
        `Customer email: ${email}\n\n` +
        `This is a custom design request, not an order. Reply to the customer with the cost once the design is ready.\n`;
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'User-Agent': 'exploded-view-shop/1.0',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: 'jvitalbc@gmail.com',
          subject: 'New car design request - ' + year + ' ' + make + ' ' + model,
          text,
        }),
      });
      const respText = await resp.text();
      if (!resp.ok) throw new Error('Resend email failed: ' + resp.status + ' ' + respText);
      console.log('Design request email sent to jvitalbc@gmail.com for ' + year + ' ' + make + ' ' + model);
    } else {
      console.log('RESEND_API_KEY not set - design request logged but not emailed: ' + year + ' ' + make + ' ' + model + ' ' + email);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Design request failed:', err.message);
    res.status(500).json({ error: 'Could not send the request.' });
  }
});
// --- End design request -------------------------------------------------
app.post('/api/checkout', async (req,res) => {
  try {
    if(!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('REPLACE')) {
      return res.status(503).json({error:'Stripe checkout is not configured yet. Add STRIPE_SECRET_KEY to your server environment.'});
    }
    const items = req.body && req.body.items;
    if(!Array.isArray(items) || items.length<1 || items.length>50) return res.status(400).json({error:'Your cart is empty or invalid.'});
    const line_items = items.map((it) => {
      const id = Number(it.id);
      const quantity = Number(it.quantity);
      if(!Number.isInteger(id)||id<0||id>=products.length||!Number.isInteger(quantity)||quantity<1||quantity>20) throw new Error('Invalid cart item.');
      if(it.type!=='shirt' && it.type!=='poster') throw new Error('Invalid product type.');
      if(it.type==='shirt' && !sizes.has(it.size)) throw new Error('Select a valid t-shirt size.');
      const name = products[id] + (it.type==='shirt' ? ` — T-Shirt / ${it.size}` : ' — 8×10 Poster');
      return {
        price_data: {
          currency:'usd',
          unit_amount:it.type==='shirt'?2999:1999,
          product_data:{name,description:it.type==='shirt'?'Print-on-demand t-shirt':'8×10 in. unframed matte poster', metadata:{design_id:String(id+1),design:products[id],format:it.type,size:it.type==='shirt'?it.size:'N/A'}}
        },
        quantity
      };
    });
    const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT||3000}`).replace(/\/$/,'');
    // PATCHED (Nov 2, 2026): Jean's $7.99 flat US shipping is now a real
    // shipping rate on the Stripe checkout. Without this, shipping was $0.
    const session = await stripe().checkout.sessions.create({
      mode:'payment',payment_method_types:['card'],line_items,
      billing_address_collection:'required',
      shipping_address_collection:{allowed_countries:['US']},
      shipping_options:[{
        shipping_rate_data:{
          type:'fixed_amount',
          fixed_amount:{amount:799, currency:'usd'},
          display_name:'Standard US shipping',
          delivery_estimate:{minimum:{unit:'business_day', value:4}, maximum:{unit:'business_day', value:8}}
        }
      }],
      phone_number_collection:{enabled:true},
      success_url:base+'/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:base+'/?checkout=cancelled',
      custom_text:{shipping_address:{message:'Printed on demand. Please allow 4–8 business days for printing and shipping.'}}
    });
    res.json({url:session.url});
  }catch(err){res.status(err.message==='Invalid cart item.'||err.message==='Invalid product type.'||err.message==='Select a valid t-shirt size.'?400:500).json({error:err.message||'Checkout failed.'});}
});
app.listen(process.env.PORT||3000,()=>console.log('Exploded View Vehicle Shop server running'));
