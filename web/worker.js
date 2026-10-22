/**
 * Mountain Pine Media — inquiry form endpoint.
 *
 * The site is static assets; this Worker exists only so the contact form has somewhere
 * to POST. Every other request falls straight through to the assets binding, so adding
 * this changed nothing about how the rest of the site is served.
 *
 * Four filters stand in front of the send, ordered cheapest first so a flood costs as
 * little as possible: same-origin, rate limit, honeypot, then Turnstile — which is the
 * only one that spends a network round trip.
 *
 * Ported from Lake & Pine's review endpoint. The guardrails are identical; what differs
 * is the payload, which has two required fields rather than one.
 */

import { renderEmail } from './email.js';

const LIMITS = { name: 120, brokerage: 120, email: 200, listing: 300, notes: 5000 };

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Must match data-action on the widget in index.html. Pinned at verify time so a token
// minted by some other widget can't be spent here.
const TURNSTILE_ACTION = 'inquiry';

// Cloudflare's documented dummy secrets, used by `wrangler dev` via web/.dev.vars.
const TESTING_SECRETS = new Set([
  '1x0000000000000000000000000000000AA', // always passes
  '2x0000000000000000000000000000000AA', // always fails
  '3x0000000000000000000000000000000AA'  // always reports "token already spent"
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/inquiry') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
      }
      return handleInquiry(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleInquiry(request, env, url) {
  // 1. Same origin. The page submits with fetch(), so a real browser always sends
  // Origin and it always equals ours. Forgeable by anything that isn't a browser,
  // which is the point: it costs nothing and drops drive-by scripted posts.
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigin(origin, url, env)) {
    return json({ error: 'Forbidden' }, 403);
  }

  // 2. Rate limit, keyed per IP. The binding's period is capped at 60s, so this is a
  // burst limiter rather than a daily cap — it stops a flood, which is the failure
  // mode that actually costs us. Guarded because `wrangler dev` without the binding
  // configured shouldn't crash the endpoint.
  if (env.INQUIRY_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.INQUIRY_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: 'Too many submissions just now. Give it a minute and try again.' }, 429);
    }
  }

  let data;
  try {
    data = await request.json();
  } catch (_) {
    return json({ error: 'Could not read that submission.' }, 400);
  }

  // 3. Honeypot. Answer as though it worked — telling a bot it was caught only helps it.
  if (str(data.website)) {
    return json({ ok: true }, 200);
  }

  // Single-line fields have their whitespace collapsed: they land in the subject line,
  // and the page's inputs can't produce a newline, so one arriving here is not a person.
  const name = line(data.name).slice(0, LIMITS.name);
  const brokerage = line(data.brokerage).slice(0, LIMITS.brokerage);
  const email = line(data.email).slice(0, LIMITS.email);
  const listing = line(data.listing).slice(0, LIMITS.listing);
  const notes = str(data.notes).slice(0, LIMITS.notes);

  // Name and email are required, unlike the review form where only the rating is. An
  // inquiry nobody can answer is no use, and the email becomes reply_to, so a malformed
  // one would either be refused by Resend or arrive looking replyable and silently not be.
  const invalid = [];
  if (!name) invalid.push('name');
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) invalid.push('email');
  if (invalid.length) {
    return json({ error: `Missing or invalid: ${invalid.join(', ')}` }, 400);
  }

  // 4. Turnstile. Last, because it is the only check that costs a round trip — no point
  // spending one on a submission the free checks above already rejected.
  const verdict = await verifyTurnstile(request, env, url, str(data['cf-turnstile-response']));
  if (!verdict.ok) {
    return json({ error: verdict.error }, verdict.status);
  }

  const key = env.RESEND_API_KEY;
  if (!key) {
    console.error('RESEND_API_KEY is not set');
    return json({ error: 'Email is not configured.' }, 500);
  }

  const to = env.INQUIRY_TO || 'mtnpinemedia@gmail.com';
  const from = env.INQUIRY_FROM || 'Mountain Pine Media <inquiries@mountain-pine-media.com>';

  // Resend takes text and html together; clients pick whichever they render.
  const mail = renderEmail({ name, brokerage, email, listing, notes });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      // So hitting reply in the inbox goes to the agent, not to the Worker's sender.
      reply_to: email,
      ...mail
    })
  });

  if (!res.ok) {
    console.error('Resend rejected the send', res.status, await res.text());
    return json({ error: 'Could not send that right now.' }, 502);
  }

  return json({ ok: true }, 200);
}

/**
 * Accepts a post from our own page. ALLOWED_ORIGINS (comma-separated) is an override
 * for the case where the page is served from a hostname the Worker doesn't see itself
 * as — a preview deployment, say. Without it this is simply same-origin, which needs
 * no configuration and can't be left misconfigured.
 */
function allowedOrigin(origin, url, env) {
  if (origin === url.origin) return true;
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
    .includes(origin);
}

async function verifyTurnstile(request, env, url, token) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fails closed, like a missing Resend key. Spam protection that switches itself off
    // when its config goes missing is the one failure mode worth refusing outright.
    console.error('TURNSTILE_SECRET_KEY is not set');
    return { ok: false, status: 500, error: 'Spam protection is not configured.' };
  }

  if (!token || token.length > 2048) {
    return { ok: false, status: 403, error: HUMAN_CHECK_FAILED };
  }

  let result;
  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || ''
      })
    });
    if (!res.ok) throw new Error(`siteverify returned ${res.status}`);
    result = await res.json();
  } catch (err) {
    // Reaching Cloudflare failed, which is not the submitter's fault — 502, not 403,
    // so the page can tell them to try again rather than accusing them of being a bot.
    console.error('Turnstile verification could not complete', err);
    return { ok: false, status: 502, error: 'Could not check that right now. Please try again.' };
  }

  // Tokens are single-use and expire after 300 seconds; the widget refreshes itself, and
  // the page resets it after a failed submit so a retry doesn't spend a spent token.
  //
  // Cloudflare's testing secrets answer with hostname "example.com" and no action field
  // at all, so pinning either one would reject every submission under `wrangler dev`.
  // Detected from the configured secret rather than from the response, so the decision
  // can't be influenced by what comes back over the network. This costs nothing in
  // production: a testing secret there already passes everything regardless.
  const testing = TESTING_SECRETS.has(secret);
  if (testing) {
    console.warn('Turnstile is using a testing secret — action and hostname are not pinned');
  }

  const expectedHostname = env.TURNSTILE_EXPECT_HOSTNAME || url.hostname;
  const ok = result.success && (testing || (
    result.action === TURNSTILE_ACTION &&
    result.hostname === expectedHostname
  ));

  if (!ok) {
    // error-codes is logged because the likely configuration mistakes — a wrong secret,
    // or the dummy testing sitekey left in the page against a live secret — look exactly
    // like a genuine bot from the outside otherwise.
    console.error('Turnstile rejected a submission', JSON.stringify({
      success: result.success,
      action: result.action,
      hostname: result.hostname,
      expectedHostname,
      codes: result['error-codes']
    }));
    return { ok: false, status: 403, error: HUMAN_CHECK_FAILED };
  }

  return { ok: true };
}

const HUMAN_CHECK_FAILED =
  'We could not confirm that submission. Please reload the page and try once more.';

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function line(value) {
  return str(value).replace(/\s+/g, ' ');
}

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
