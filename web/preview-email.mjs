/**
 * Render the inquiry notification email to local files so it can be eyeballed
 * without sending anything.
 *
 *   node preview-email.mjs           # writes to ./.email-preview/
 *   node preview-email.mjs --open    # …and opens the HTML (macOS)
 *
 * It imports the same renderEmail() the Worker uses, so what you see here is what
 * actually goes out. Output is gitignored.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

import { renderEmail } from './email.js';

const CASES = {
  'full': {
    name: 'Dana Whitaker',
    brokerage: 'Sierra Ridge Realty',
    email: 'dana@example.com',
    listing: '1450 Ridgeview Dr, Reno — list by Nov 3',
    notes: 'Four bed, three bath, about 2,800 sq ft. Sellers move out on the 28th, so any day after that works.\n\nWould love a twilight set if the weather cooperates.'
  },
  // The floor: name and email are the only required fields, so this is the least an
  // arriving inquiry can be. Every fallback in the template is on show at once.
  'minimal': {
    name: 'Marcus Lee',
    brokerage: '',
    email: 'marcus@example.com',
    listing: '',
    notes: ''
  },
  // Characters that must be escaped rather than rendered as markup, and a pasted link,
  // which is ordinary for an agent and deliberately not flagged.
  'escaping-and-link': {
    name: 'Ortiz & Daughters <Team>',
    brokerage: 'Ortiz & Co.',
    email: 'team@example.net',
    listing: '88 Lakeview Ct, Incline Village',
    notes: 'Listing page is https://www.zillow.com/homedetails/88-lakeview — the <em>dock</em> & boathouse need the drone.'
  },
  'long-notes': {
    name: 'Priya Raghunathan-Whitfield',
    brokerage: 'Northern Nevada Luxury Properties',
    email: 'priya.raghunathan-whitfield@example-brokerage.com',
    listing: '2210 Old Washoe Estates Rd, Washoe Valley — photos, film, and aerials before the Dec 1 launch',
    notes: 'This one is on twelve acres with a barn, an arena, and a guest house, so it is a lot more than a standard shoot. The sellers are particular about the interiors and want them staged before photos, which pushes us to the week of the 17th at the earliest. I would like the film to open on the approach down the drive and the aerials to show how the parcel sits against the Washoe Lake side. Happy to walk it with you beforehand if that helps plan the day.'
  }
};

const dir = new URL('./.email-preview/', import.meta.url);
await mkdir(dir, { recursive: true });

const index = [];
for (const [slug, fields] of Object.entries(CASES)) {
  const { subject, html, text } = renderEmail(fields);
  await writeFile(new URL(`./${slug}.html`, dir), html);
  await writeFile(new URL(`./${slug}.txt`, dir), `Subject: ${subject}\n\n${text}\n`);
  index.push({ slug, subject });
  console.log(`${slug.padEnd(20)} ${subject}`);
}

const list = index
  .map(i => `<li><a href="${i.slug}.html">${i.slug}</a> &mdash; <code>${i.subject.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code> &nbsp;<a href="${i.slug}.txt">text</a></li>`)
  .join('\n');
await writeFile(new URL('./index.html', dir), `<!DOCTYPE html>
<meta charset="utf-8"><title>Email preview</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px}
code{background:#eee;padding:2px 5px}li{margin:10px 0}</style>
<h1>Inquiry email preview</h1>
<p>Rendered by <code>preview-email.mjs</code> from the same template the Worker sends.</p>
<ul>\n${list}\n</ul>`);

console.log(`\nWrote ${index.length} previews to web/.email-preview/`);

if (process.argv.includes('--open')) {
  execFile('open', [new URL('./index.html', dir).pathname]);
}
