/**
 * Inquiry notification email — shared by worker.js and preview-email.mjs.
 *
 * Lives in its own module so the preview renders the exact template that gets sent;
 * a preview that can drift from the real thing is worse than no preview.
 *
 * Written for the studio, not for whoever maintains the site: it reports an inquiry in
 * readable form, leads with the listing, and stops there.
 *
 * Unlike Lake & Pine's review email, a link in the notes is not flagged. An agent
 * pasting the MLS or Zillow page for the listing is an ordinary inquiry, so the
 * heuristic that works for wedding reviews would mostly flag real business here.
 *
 * Email is not the web. Three constraints shape everything below:
 *   1. Google Fonts do not load. Gmail strips the <link>, Outlook ignores it. Fraunces
 *      and IBM Plex Mono are unavailable, so the serif falls back to Georgia and the
 *      mono to the system monospace stack.
 *   2. Styles are inline. Several clients drop <style> blocks entirely.
 *   3. Layout is tables. Desktop Outlook renders with Word's engine, which has no
 *      meaningful flexbox or grid support.
 */

const C = {
  lakeDeep: '#14293A',
  lakeMid: '#3E7488',
  alpine: '#F4F7F7',
  paper: '#FFFFFF',
  brass: '#B8863B',
  ink: '#16232A',
  rule: 'rgba(20,41,58,0.14)'
};

const NO_LISTING = 'No address or date given.';
const NO_NOTES = 'No notes.';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

export function renderEmail(f) {
  // Name and email are required, so the subject can always name who it's from. The
  // listing leads when there is one, matching the subject the old mailto: draft used.
  return {
    subject: f.listing
      ? `Shoot inquiry — ${f.listing} (${f.name})`
      : `Shoot inquiry — ${f.name}`,
    text: text(f),
    html: html(f)
  };
}

/* ---------------------------------------------------------------- plain text */
/* Kept alongside the HTML, not replaced by it: Resend sends both and the client picks. */
function text(f) {
  return [
    `Listing:    ${f.listing || NO_LISTING}`,
    '',
    f.notes || NO_NOTES,
    '',
    '—'.repeat(48),
    `From:       ${f.name} <${f.email}>`,
    `Brokerage:  ${f.brokerage || '(not given)'}`,
    '—'.repeat(48),
    `Reply to this email to reach ${f.name}.`
  ].join('\n');
}

/* ---------------------------------------------------------------------- html */
function html(f) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(`Shoot inquiry — ${f.name}`)}</title>
</head>
<body style="margin:0;padding:0;background:${C.alpine};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.alpine};">
<tr><td align="center" style="padding:28px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;table-layout:fixed;background:${C.paper};border:1px solid ${C.rule};">

    <tr><td style="background:${C.lakeDeep};padding:26px 32px;">
      <div style="font-family:${MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${C.brass};">New Inquiry</div>
      <div style="font-family:${SERIF};font-weight:bold;font-size:17px;letter-spacing:0.02em;color:${C.alpine};padding-top:7px;">MOUNTAIN <span style="color:${C.brass};">PINE</span> MEDIA</div>
    </td></tr>

    <tr><td style="background:${C.alpine};padding:28px 32px 30px;border-bottom:1px solid ${C.rule};">
      ${label('Listing')}
      <div style="font-family:${SERIF};font-size:20px;line-height:1.4;color:${C.ink};padding-top:8px;${f.listing ? '' : 'opacity:0.55;'}">
        ${escapeHtml(f.listing || NO_LISTING)}
      </div>
      <div style="font-family:${SANS};font-size:15px;line-height:1.65;color:${C.ink};padding-top:18px;${f.notes ? '' : 'opacity:0.55;'}">
        ${f.notes ? escapeHtml(f.notes).replace(/\r?\n/g, '<br>') : escapeHtml(NO_NOTES)}
      </div>
    </td></tr>

    <tr><td style="padding:22px 32px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${row('From', escapeHtml(`${f.name} <${f.email}>`))}
        ${row('Brokerage', escapeHtml(f.brokerage) || notGiven(), true)}
      </table>
    </td></tr>

    <tr><td style="background:${C.alpine};padding:16px 32px;border-top:1px solid ${C.rule};">
      <div style="font-family:${SANS};font-size:11px;line-height:1.5;color:${C.lakeMid};">
        Sent by the inquiry form at mountain-pine-media.com · reply to reach ${escapeHtml(f.name)}
      </div>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

function label(value) {
  return `<div style="font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${C.lakeMid};">${value}</div>`;
}

function notGiven() {
  return '<span style="opacity:0.5;">not given</span>';
}

function row(name, value, last) {
  return `<tr>
    <td style="font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${C.lakeMid};padding:9px 14px 9px 0;white-space:nowrap;vertical-align:top;border-bottom:${last ? 'none' : `1px solid ${C.rule}`};">${name}</td>
    <td style="font-family:${SANS};font-size:14px;color:${C.ink};padding:9px 0;vertical-align:top;word-wrap:break-word;border-bottom:${last ? 'none' : `1px solid ${C.rule}`};">${value}</td>
  </tr>`;
}

/* --------------------------------------------------------------------- utils */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
