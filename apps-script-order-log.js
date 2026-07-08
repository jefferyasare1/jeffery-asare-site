// ══════════════════════════════════════════════════════════════════════
//  JEFFERY ASARE — Order Log  (Google Apps Script)
//  Paste the entire contents of this file into your Apps Script project,
//  replacing everything that's there. Then click Deploy → New Deployment
//  → Web App → Execute as Me → Who has access: Anyone → Deploy.
//  Copy the new URL and update SHEET_URL in central-admin.html.
// ══════════════════════════════════════════════════════════════════════

var SHEET_NAME = 'Orders';

// ── Column layout ──────────────────────────────────────────────
// A: Date  B: Action  C: Buyer Name  D: Buyer Email
// E: Print Title  F: Notes  G: Order Ref
var HEADERS = ['Date','Action','Buyer Name','Buyer Email','Print Title','Notes','Order Ref'];

// ── GET — returns all orders as JSON (used by central-admin sync) ─
function doGet(e) {
  try {
    var sheet  = getSheet();
    var data   = sheet.getDataRange().getValues();
    if (data.length <= 1) { return jsonResponse([]); }

    var rows = data.slice(1).map(function(row) {
      return {
        'Date':        formatDate(row[0]),
        'Action':      row[1],
        'Buyer Name':  row[2],
        'Buyer Email': row[3],
        'Print Title': row[4],
        'Notes':       row[5],
        'Order Ref':   row[6] || ''
      };
    });

    return jsonResponse(rows);
  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── POST — log an action row ────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet();
    ensureHeaders(sheet);
    sheet.appendRow([
      data.date        || new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra' }),
      data.action      || '',
      data.buyer_name  || '',
      data.buyer_email || '',
      data.print_title || '',
      data.notes       || '',
      data.order_ref   || ''
    ]);
    return jsonResponse({ status: 'ok' });
  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── Gmail auto-import (run on a time trigger) ───────────────────
// In Apps Script: click the clock icon → Add Trigger →
//   Function: importOrdersFromGmail
//   Event source: Time-driven → Hour timer → Every hour
//
function importOrdersFromGmail() {
  var sheet = getSheet();
  ensureHeaders(sheet);

  // Get all existing order refs and email+title pairs to avoid duplicates
  var existing = {};
  var data = sheet.getDataRange().getValues();
  data.slice(1).forEach(function(row) {
    var ref   = String(row[6] || '').trim();
    var key   = String(row[3] || '').trim() + '||' + String(row[4] || '').trim();
    if (ref)  existing[ref] = true;
    if (key !== '||') existing[key] = true;
  });

  // Search Gmail for Formspree order alert emails not yet imported
  var threads = GmailApp.search('from:formspree subject:"New submission" -label:ja-imported', 0, 20);

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(msg) {
      var body = msg.getPlainBody();

      // Parse the key fields Formspree includes in the notification email
      var buyerEmail = extractField(body, 'buyer')      || extractField(body, '_replyto') || '';
      var items      = extractField(body, 'items')      || '';
      var price      = extractField(body, 'price')      || '';
      var country    = extractField(body, 'country')    || '';
      var orderRef   = extractField(body, 'order_ref')  || extractField(body, 'order ref') || '';

      // Best guess at buyer name — Formspree may include it, or we use email prefix
      var buyerName  = extractField(body, 'buyer_name') || extractField(body, 'name') ||
                       (buyerEmail ? buyerEmail.split('@')[0] : 'Unknown');

      // Print title is the first part of the items field (before ' — ')
      var printTitle = items ? items.split('—')[0].split('–')[0].trim() : '';

      if (!buyerEmail) return; // Skip if no email found

      // Deduplicate
      var refKey = orderRef;
      var emailKey = buyerEmail + '||' + printTitle;
      if ((refKey && existing[refKey]) || existing[emailKey]) return;

      var sentDate = msg.getDate();
      var dateStr  = Utilities.formatDate(sentDate, 'Africa/Accra', 'dd/MM/yyyy, HH:mm:ss');

      sheet.appendRow([
        dateStr, 'Order Received', buyerName, buyerEmail,
        printTitle, [items, price, country].filter(Boolean).join(' · '), orderRef
      ]);

      if (refKey)   existing[refKey]   = true;
      existing[emailKey] = true;

      // Label the thread so we don't re-import it
      ensureLabel('ja-imported');
      thread.addLabel(GmailApp.getUserLabelByName('ja-imported'));
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────
function getSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Africa/Accra', 'dd/MM/yyyy, HH:mm:ss');
  }
  return String(val);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function extractField(body, fieldName) {
  // Matches "fieldname: value" or "fieldname = value" (case-insensitive)
  var re = new RegExp(fieldName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*[=:]\\s*([^\\n\\r]+)', 'i');
  var m  = body.match(re);
  return m ? m[1].trim() : '';
}

function ensureLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) GmailApp.createLabel(name);
}
