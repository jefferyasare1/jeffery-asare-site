// ══════════════════════════════════════════════════════════════════════
//  JEFFERY ASARE — Order Log  (Google Apps Script)
//  Paste the entire contents of this file into your Apps Script project,
//  replacing everything that's there. Then click Deploy → New Deployment
//  → Web App → Execute as Me → Who has access: Anyone → Deploy.
//  Copy the new URL and update SHEET_URL in central-admin.html.
// ══════════════════════════════════════════════════════════════════════

var SHEET_NAME     = 'Orders';
var SPREADSHEET_ID = '1NrC5N_Uoe_C8o8R3_zGNP35xhr4mHmpW6_xfts21WHo';

// ── Column layout ──────────────────────────────────────────────
// A: Date  B: Action  C: Buyer Name  D: Buyer Email
// E: Print Title  F: Size  G: Country  H: Notes  I: Order Ref
var HEADERS = ['Date','Action','Buyer Name','Buyer Email','Print Title','Size','Country','Notes','Order Ref'];

// ── Gmail label names ──────────────────────────────────────────
var LABELS = {
  order:    'JA Shop/Order',
  ship:     'JA Shop/Shipping',
  coa:      'JA Shop/COA',
  followup: 'JA Shop/Follow-up',
  waitlist: 'JA Shop/Waitlist',
  imported: 'ja-imported'
};

// ── GET — returns all orders as JSON (used by central-admin sync) ─
function doGet(e) {
  try {
    var sheet = getSheet();
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) { return jsonResponse([]); }

    var rows = data.slice(1).map(function(row) {
      return {
        'Date':        formatDate(row[0]),
        'Action':      row[1],
        'Buyer Name':  row[2],
        'Buyer Email': row[3],
        'Print Title': row[4],
        'Size':        row[5] || '',
        'Country':     row[6] || '',
        'Notes':       row[7],
        'Order Ref':   row[8] || ''
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
    var data  = JSON.parse(e.postData.contents);
    var sheet = getSheet();
    ensureHeaders(sheet);
    sheet.appendRow([
      data.date        || new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra' }),
      data.action      || '',
      data.buyer_name  || '',
      data.buyer_email || '',
      data.print_title || '',
      data.size        || '',
      data.country     || '',
      data.notes       || '',
      data.order_ref   || ''
    ]);
    return jsonResponse({ status: 'ok' });
  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── Gmail auto-import (runs every hour via time trigger) ────────
// In Apps Script: clock icon → Add Trigger →
//   Function: importOrdersFromGmail
//   Event source: Time-driven → Hour timer → Every hour
//
function importOrdersFromGmail() {
  setupLabels();

  var sheet = getSheet();
  ensureHeaders(sheet);

  // Get existing refs to avoid duplicates
  var existing = {};
  var data = sheet.getDataRange().getValues();
  data.slice(1).forEach(function(row) {
    var ref  = String(row[8] || '').trim();   // col I = Order Ref
    var key  = String(row[3] || '').trim() + '||' + String(row[4] || '').trim();
    if (ref)          existing[ref] = true;
    if (key !== '||') existing[key] = true;
  });

  // Search for Formspree order alert emails not yet imported
  var threads = GmailApp.search(
    'from:formspree subject:"New submission" -label:ja-imported', 0, 20
  );

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      var body = msg.getPlainBody();

      var buyerEmail = extractField(body, 'buyer')      || extractField(body, '_replyto') || '';
      var items      = extractField(body, 'items')      || '';
      var price      = extractField(body, 'price')      || '';
      var size       = extractField(body, 'size')       || '';
      var country    = extractField(body, 'country')    || '';
      var orderRef   = extractField(body, 'order_ref')  || extractField(body, 'order ref') || '';
      var buyerName  = extractField(body, 'buyer_name') || extractField(body, 'name') ||
                       (buyerEmail ? buyerEmail.split('@')[0] : 'Unknown');
      var printTitle = items ? items.split('—')[0].split('–')[0].trim() : '';

      if (!buyerEmail) return;

      var refKey   = orderRef;
      var emailKey = buyerEmail + '||' + printTitle;
      if ((refKey && existing[refKey]) || existing[emailKey]) return;

      var sentDate = msg.getDate();
      var dateStr  = Utilities.formatDate(sentDate, 'Africa/Accra', 'dd/MM/yyyy, HH:mm:ss');

      sheet.appendRow([
        dateStr, 'Order Received', buyerName, buyerEmail,
        printTitle, size, country, [items, price].filter(Boolean).join(' · '), orderRef
      ]);

      if (refKey) existing[refKey] = true;
      existing[emailKey] = true;

      // Label: ja-imported + JA Shop/Order
      thread.addLabel(getOrCreateLabel(LABELS.imported));
      thread.addLabel(getOrCreateLabel(LABELS.order));
    });
  });

  // Label sent emails too (COA, Shipping, Follow-up, Waitlist)
  labelSentEmails();
}

// ── Label sent emails by type ────────────────────────────────────
// Add this as a second hourly trigger OR call from importOrdersFromGmail
function labelSentEmails() {
  setupLabels();
  var searches = [
    {
      query: 'in:sent (subject:"Certificate of Authenticity" OR subject:"COA")',
      label: LABELS.coa
    },
    {
      query: 'in:sent (subject:"shipped" OR subject:"on its way" OR subject:"tracking")',
      label: LABELS.ship
    },
    {
      query: 'in:sent (subject:"follow" OR subject:"how did everything arrive")',
      label: LABELS.followup
    },
    {
      query: 'in:sent (subject:"waitlist" OR subject:"on the list")',
      label: LABELS.waitlist
    }
  ];

  searches.forEach(function(s) {
    var threads = GmailApp.search(s.query, 0, 20);
    var lbl = getOrCreateLabel(s.label);
    threads.forEach(function(t) { t.addLabel(lbl); });
  });
}

// ── Run once to create all labels ───────────────────────────────
function setupLabels() {
  Object.keys(LABELS).forEach(function(k) { getOrCreateLabel(LABELS[k]); });
}

// ── Helpers ─────────────────────────────────────────────────────
function getSheet() {
  // openById works for standalone scripts (getActiveSpreadsheet only works when bound)
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
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
  var re = new RegExp(
    fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[=:]\\s*([^\\n\\r]+)', 'i'
  );
  var m = body.match(re);
  return m ? m[1].trim() : '';
}

function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}
