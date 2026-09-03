/**
 * BlinkLoop website form -> info@blinkloopph.com
 * Runs inside your Google Workspace account (Apps Script). Nothing else involved.
 *
 * SETUP (once, ~5 minutes), signed in as info@blinkloopph.com:
 *  1. Go to https://script.google.com  ->  New project
 *  2. Delete the sample code, paste this whole file, click the save icon.
 *  3. Deploy -> New deployment -> gear icon -> "Web app"
 *       Description:      BlinkLoop form
 *       Execute as:       Me
 *       Who has access:   Anyone
 *     Click Deploy, approve the permissions prompt (it asks to send email as you).
 *  4. Copy the "Web app URL" (ends in /exec) and paste it into the website's
 *     FORM_ENDPOINT constant (or send it to Jose/Claude to wire in).
 *
 *  To update later: edit here, then Deploy -> Manage deployments -> pencil -> New version.
 */

var TO = 'info@blinkloopph.com';
var SERVICES = ['Website build', 'Hosting and care', 'Build plus hosting', 'Something else'];

function doPost(e) {
  var out = { ok: false };
  try {
    var d = {};
    if (e && e.postData && e.postData.contents) {
      try { d = JSON.parse(e.postData.contents); } catch (err) { d = (e.parameter || {}); }
    } else if (e && e.parameter) {
      d = e.parameter;
    }

    // Spam trap: real visitors never fill this in. Pretend success, send nothing.
    if (clean(d.website, 200)) return json({ ok: true });

    var name     = clean(d.name, 80);
    var email    = clean(d.email, 120).toLowerCase();
    var business = clean(d.business, 120);
    var service  = SERVICES.indexOf(d.service) >= 0 ? d.service : 'Something else';
    var message  = String(d.message || '').replace(/\r\n?/g, '\n').trim().slice(0, 3000);

    if (name.length < 2)  return json({ ok: false, reason: 'name' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, reason: 'email' });
    if (message.length < 5) return json({ ok: false, reason: 'message' });

    var when = Utilities.formatDate(new Date(), 'Asia/Manila', 'MMM d, yyyy h:mm a');
    var subject = 'New inquiry: ' + name + (business ? ' (' + business + ')' : '') + ' \u00b7 ' + service;

    var text = [
      'New inquiry from the BlinkLoop website',
      '',
      'Name:      ' + name,
      'Email:     ' + email,
      'Business:  ' + (business || '(not given)'),
      'Needs:     ' + service,
      'Received:  ' + when + ' (PH time)',
      '',
      'Message:',
      message,
      '',
      'Reply directly to this email to answer ' + name + '.'
    ].join('\n');

    var html =
      '<div style="font-family:Sora,Segoe UI,Arial,sans-serif;max-width:560px;color:#2B140E">' +
      '<h2 style="margin:0 0 14px;font-size:18px">New inquiry from the BlinkLoop website</h2>' +
      '<table style="border-collapse:collapse;font-size:14px">' +
      row('Name', '<b>' + esc(name) + '</b>') +
      row('Email', '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>') +
      row('Business', esc(business || '(not given)')) +
      row('Needs', esc(service)) +
      row('Received', esc(when) + ' (PH time)') +
      '</table>' +
      '<p style="margin:18px 0 6px;color:#7E5D4C;font-size:13px">Message</p>' +
      '<div style="white-space:pre-wrap;background:#FFF7EF;border:1px solid rgba(127,32,39,.16);border-radius:12px;padding:14px;font-size:14px;line-height:1.55">' + esc(message) + '</div>' +
      '<p style="margin-top:18px;font-size:12px;color:#7E5D4C">Reply directly to this email to answer ' + esc(name) + '.</p>' +
      '</div>';

    MailApp.sendEmail({
      to: TO,
      replyTo: email,
      name: 'BlinkLoop Website',
      subject: subject,
      body: text,
      htmlBody: html
    });
    out = { ok: true };
  } catch (err) {
    out = { ok: false, reason: 'mail-failed', detail: String(err).slice(0, 200) };
  }
  return json(out);
}

// A browser visit to the URL shows this instead of an error page.
function doGet() {
  return ContentService.createTextOutput('BlinkLoop form endpoint is live.').setMimeType(ContentService.MimeType.TEXT);
}

function row(label, value) {
  return '<tr><td style="padding:4px 12px 4px 0;color:#7E5D4C">' + label + '</td><td>' + value + '</td></tr>';
}
function clean(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
