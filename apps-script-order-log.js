// ══════════════════════════════════════════════════════════════════════
//  JEFFERY ASARE — Order Log  (Google Apps Script)
//  Paste the entire contents of this file into your Apps Script project,
//  replacing everything that's there. Then:
//  1. Run createTrigger() once to set up the hourly auto-import
//  2. Deploy → Manage deployments → Edit → New version → Deploy
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

  // FIX: Search for order alert emails — subject is "New sale: ..." (set by sendOrderAlert)
  // Also catches "New submission" as fallback for any direct Formspree form submissions
  var threads = GmailApp.search(
    'from:formspree.io (subject:"New sale" OR subject:"New submission") -label:ja-imported', 0, 50
  );

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      var body = msg.getPlainBody();

      var buyerEmail = extractField(body, 'buyer')      || extractField(body, '_replyto') || '';
      var buyerName  = extractField(body, 'buyer_name') || extractField(body, 'name')     || '';
      var items      = extractField(body, 'items')      || '';
      var price      = extractField(body, 'price')      || '';
      var country    = extractField(body, 'country')    || '';
      var orderRef   = extractField(body, 'order_ref')  || extractField(body, 'order ref') || '';

      // Extract size: use explicit field first, then parse from items string "Title — Size ×qty"
      var size = extractField(body, 'size') || '';
      if (!size && items) {
        var parts = items.split(/[—–]/);
        if (parts.length > 1) {
          size = parts[1].replace(/\s*×\s*\d+.*$/, '').trim();
        }
      }

      // Print title is everything before the dash in items
      var printTitle = items ? items.split(/[—–]/)[0].trim() : '';

      // Fall back to email prefix for name if not provided
      if (!buyerName && buyerEmail) buyerName = buyerEmail.split('@')[0];
      if (!buyerName) buyerName = 'Unknown';

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

  // Label sent emails (COA, Shipping, Follow-up, Waitlist)
  labelSentEmails();
}

// ── Label sent emails by type ────────────────────────────────────
function labelSentEmails() {
  setupLabels();
  var searches = [
    {
      // COA emails sent from central admin or auto-sent from shop
      query: 'in:sent (subject:"Certificate of Authenticity" OR subject:"COA" OR subject:"certificate")',
      label: LABELS.coa
    },
    {
      // Shipping / tracking emails
      query: 'in:sent (subject:"shipped" OR subject:"on its way" OR subject:"tracking" OR subject:"dispatch" OR subject:"delivery")',
      label: LABELS.ship
    },
    {
      // Follow-up emails
      query: 'in:sent (subject:"follow" OR subject:"how did everything" OR subject:"arrived" OR subject:"enjoying")',
      label: LABELS.followup
    },
    {
      // Waitlist emails
      query: 'in:sent (subject:"waitlist" OR subject:"on the list" OR subject:"back in stock" OR subject:"available")',
      label: LABELS.waitlist
    }
  ];

  searches.forEach(function(s) {
    var threads = GmailApp.search(s.query, 0, 50);
    var lbl = getOrCreateLabel(s.label);
    threads.forEach(function(t) { t.addLabel(lbl); });
  });
}

// ── Create the hourly trigger (run this ONCE from the editor) ───
function createTrigger() {
  // Delete any existing importOrdersFromGmail triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'importOrdersFromGmail') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  // Create a new hourly trigger
  ScriptApp.newTrigger('importOrdersFromGmail')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('✓ Hourly trigger created for importOrdersFromGmail');
}

// ── Run once to create all labels ───────────────────────────────
function setupLabels() {
  Object.keys(LABELS).forEach(function(k) { getOrCreateLabel(LABELS[k]); });
}

// ── Helpers ─────────────────────────────────────────────────────
function getSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders(sheet) {
  // Allow standalone call (no arg) from the function dropdown
  if (!sheet) sheet = getSheet();
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
