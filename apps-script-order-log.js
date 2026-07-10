// ══════════════════════════════════════════════════════════════════════
//  JEFFERY ASARE — Order Log  (Google Apps Script)
//  Paste entire file into Apps Script, replacing everything.
//  Then: run createTrigger() once, then Deploy → Manage → Edit → New version → Deploy.
// ══════════════════════════════════════════════════════════════════════

var SHEET_NAME     = 'Orders';
var SPREADSHEET_ID = '1NrC5N_Uoe_C8o8R3_zGNP35xhr4mHmpW6_xfts21WHo';

// ── Column layout (11 columns) ─────────────────────────────────
// A: Date  B: Action  C: Buyer Name  D: Buyer Email
// E: Print Title  F: Size  G: Country  H: Price  I: Qty  J: Notes  K: Order Ref
var HEADERS = ['Date','Action','Buyer Name','Buyer Email','Print Title','Size','Country','Price','Qty','Notes','Order Ref'];

// ── Gmail label names ──────────────────────────────────────────
var LABELS = {
  order:    'JA Shop/Order',
  ship:     'JA Shop/Shipping',
  coa:      'JA Shop/COA',
  followup: 'JA Shop/Follow-up',
  waitlist: 'JA Shop/Waitlist',
  imported: 'ja-imported'
};

// ── GET — returns all orders as JSON ───────────────────────────
function doGet(e) {
  try {
    var sheet = getSheet();
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) { return jsonResponse([]); }

    var rows = data.slice(1).map(function(row) {
      return {
        'Date':        row[0] ? String(row[0]) : '',
        'Action':      row[1] || '',
        'Buyer Name':  row[2] || '',
        'Buyer Email': row[3] || '',
        'Print Title': row[4] || '',
        'Size':        row[5] || '',
        'Country':     row[6] || '',
        'Price':       row[7] || '',
        'Qty':         row[8] || '',
        'Notes':       row[9] || '',
        'Order Ref':   row[10] || ''
      };
    });

    return jsonResponse(rows);
  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── POST — log an action row or update buyer name ──────────────
function doPost(e) {
  try {
    var data  = JSON.parse(e.postData.contents);
    var sheet = getSheet();
    ensureHeaders(sheet);

    // Special case: update buyer name on existing row by order_ref
    if (data.action === 'Update Buyer' && data.order_ref && data.buyer_name) {
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][10]).trim() === String(data.order_ref).trim()) {
          sheet.getRange(i + 1, 3).setValue(data.buyer_name); // Column C = Buyer Name
          return jsonResponse({ status: 'updated', row: i + 1 });
        }
      }
      return jsonResponse({ status: 'not_found', order_ref: data.order_ref });
    }

    sheet.appendRow([
      formatNow(),
      data.action      || '',
      data.buyer_name  || '',
      data.buyer_email || '',
      data.print_title || '',
      data.size        || '',
      data.country     || '',
      data.price       || '',
      data.qty         || '',
      data.notes       || '',
      data.order_ref   || ''
    ]);
    return jsonResponse({ status: 'ok' });
  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ── Gmail auto-import (runs every hour via trigger) ────────────
function importOrdersFromGmail() {
  setupLabels();

  var sheet = getSheet();
  ensureHeaders(sheet);

  // Build duplicate index (Order Ref now col K = index 10)
  var existing = {};
  var data = sheet.getDataRange().getValues();
  data.slice(1).forEach(function(row) {
    var ref = String(row[10] || '').trim();
    var key = String(row[3]  || '').trim() + '||' + String(row[4] || '').trim();
    if (ref)          existing[ref] = true;
    if (key !== '||') existing[key] = true;
  });

  // Search for order alert emails — subject set to "New sale: ..." by sendOrderAlert()
  // Also catches plain "New submission" Formspree emails as fallback
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
      var qty        = extractField(body, 'qty')        || '';
      var country    = extractField(body, 'country')    || '';
      var orderRef   = extractField(body, 'order_ref')  || extractField(body, 'order ref') || '';

      // Size: explicit field first, then parse from items "Title | Size x qty"
      var size = extractField(body, 'size') || '';
      if (!size && items) {
        var sep = items.indexOf(' | ');
        if (sep !== -1) {
          var afterSep = items.substring(sep + 3);
          // strip trailing " x N" quantity
          size = afterSep.replace(/\s*x\s*\d+\s*$/, '').trim();
        }
      }

      // Print title: everything before the separator
      var printTitle = '';
      if (items) {
        var pipeIdx = items.indexOf(' | ');
        printTitle = pipeIdx !== -1 ? items.substring(0, pipeIdx).trim() : items.trim();
      }

      // Qty: explicit field, or parse from items "... x N"
      if (!qty && items) {
        var qMatch = items.match(/x\s*(\d+)\s*$/i);
        if (qMatch) qty = qMatch[1];
      }
      if (!qty) qty = '1';

      // Name fallback to email prefix
      if (!buyerName && buyerEmail) buyerName = buyerEmail.split('@')[0];
      if (!buyerName) buyerName = 'Unknown';

      if (!buyerEmail) return;

      var refKey   = orderRef;
      var emailKey = buyerEmail + '||' + printTitle;
      if ((refKey && existing[refKey]) || existing[emailKey]) return;

      var dateStr = Utilities.formatDate(msg.getDate(), 'Africa/Accra', 'MMMM d, yyyy');

      sheet.appendRow([
        dateStr, 'Order Received', buyerName, buyerEmail,
        printTitle, size, country, price, qty,
        items, orderRef
      ]);

      if (refKey) existing[refKey] = true;
      existing[emailKey] = true;

      thread.addLabel(getOrCreateLabel(LABELS.imported));
      thread.addLabel(getOrCreateLabel(LABELS.order));
    });
  });

  labelSentEmails();
  applyFormatting();
  buildSummaryTab();
}

// ── Label sent emails by type ──────────────────────────────────
function labelSentEmails() {
  setupLabels();
  var searches = [
    {
      query: 'in:sent (subject:"Certificate of Authenticity" OR subject:"COA" OR subject:"certificate")',
      label: LABELS.coa
    },
    {
      query: 'in:sent (subject:"shipped" OR subject:"on its way" OR subject:"tracking" OR subject:"dispatch" OR subject:"delivery")',
      label: LABELS.ship
    },
    {
      query: 'in:sent (subject:"follow" OR subject:"how did everything" OR subject:"arrived" OR subject:"enjoying")',
      label: LABELS.followup
    },
    {
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

// ── Run once to create hourly trigger ─────────────────────────
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'importOrdersFromGmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importOrdersFromGmail').timeBased().everyHours(1).create();
  Logger.log('Hourly trigger created for importOrdersFromGmail');
}

// ── Run once to create all Gmail labels ───────────────────────
function setupLabels() {
  Object.keys(LABELS).forEach(function(k) { getOrCreateLabel(LABELS[k]); });
}

// ── Helpers ───────────────────────────────────────────────────
function getSheet() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders(sheet) {
  if (!sheet) sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
}

function formatNow() {
  return Utilities.formatDate(new Date(), 'Africa/Accra', 'MMMM d, yyyy');
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

// ── Size lookup table for repair ──────────────────────────────
var SIZE_FIXES = {
  'A4 (21':  'A4 (21 x 29.7 cm)',
  'A3 (29':  'A3 (29.7 x 42 cm)',
  'A2 (42':  'A2 (42 x 59.4 cm)',
  'A1 (59':  'A1 (59.4 x 84.1 cm)',
  'A0 (84':  'A0 (84.1 x 118.9 cm)'
};

// ── Run once to fix existing Sheet rows with bad data ─────────
// Fixes: old JS date format, truncated sizes, em dash in Notes
function repairSheet() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Nothing to repair.'); return; }

  var data = sheet.getDataRange().getValues();
  var repaired = 0;

  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var date   = String(row[0] || '');
    var size   = String(row[5] || '');
    var notes  = String(row[9] || '');
    var changed = false;

    // Fix date: "9/7/2026 5:04:38" → "July 9, 2026"
    // Matches M/D/YYYY H:mm:ss or M/D/YYYY
    var dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      var d = new Date(parseInt(dateMatch[3]), parseInt(dateMatch[2])-1, parseInt(dateMatch[1]));
      var fixed = Utilities.formatDate(d, 'Africa/Accra', 'MMMM d, yyyy');
      sheet.getRange(i + 1, 1).setValue(fixed);
      changed = true;
    }

    // Fix truncated size
    for (var key in SIZE_FIXES) {
      if (size.indexOf(key) === 0 && size !== SIZE_FIXES[key]) {
        sheet.getRange(i + 1, 6).setValue(SIZE_FIXES[key]);
        changed = true;
        break;
      }
    }

    // Fix em dash separator in Notes field
    if (notes.indexOf(' — ') !== -1) {
      sheet.getRange(i + 1, 10).setValue(notes.replace(/ — /g, ' | '));
      changed = true;
    }

    if (changed) repaired++;
  }

  Logger.log('repairSheet complete. ' + repaired + ' rows updated.');
}

// ── Remove ja-imported label so Gmail threads can be re-imported ──
// Run this, then delete the bad rows from the Sheet manually,
// then run importOrdersFromGmail to pull them in fresh.
function removeImportedLabels() {
  var label = GmailApp.getUserLabelByName(LABELS.imported);
  if (!label) { Logger.log('Label not found: ' + LABELS.imported); return; }
  var threads = GmailApp.search('label:' + LABELS.imported, 0, 100);
  threads.forEach(function(t) { t.removeLabel(label); });
  Logger.log('Removed ja-imported label from ' + threads.length + ' threads. Now delete the bad rows in the Sheet and run importOrdersFromGmail.');
}

// ── Conditional formatting: colour rows by action ──────────────
// Call this after importing to keep the sheet readable at a glance.
function applyFormatting() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Colour map: action → background hex
  var colours = {
    'Order Received':  '#FFF9DB',  // pale yellow
    'Shipped':         '#DBF0FF',  // pale blue
    'COA Sent':        '#E8F5E9',  // pale green
    'Follow-up Sent':  '#F3E8FF',  // pale purple
    'Waitlist Notified':'#FFE8CC'  // pale orange
  };

  var actionCol = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // Column B = Action
  for (var i = 0; i < actionCol.length; i++) {
    var action = String(actionCol[i][0]).trim();
    var bg = colours[action] || '#FFFFFF';
    sheet.getRange(i + 2, 1, 1, HEADERS.length).setBackground(bg);
  }
  // Freeze header row
  sheet.setFrozenRows(1);
  // Auto-resize columns
  sheet.autoResizeColumns(1, HEADERS.length);
}

// ── Summary tab: totals by country, print, and month ──────────
function buildSummaryTab() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var src = ss.getSheetByName(SHEET_NAME);
  if (!src) return;

  // Get or create Stats sheet
  var stats = ss.getSheetByName('Stats');
  if (!stats) stats = ss.insertSheet('Stats');
  stats.clearContents();

  var data = src.getDataRange().getValues();
  if (data.length < 2) return;

  var orders = data.slice(1).filter(function(r){ return r[1] === 'Order Received'; });

  // By Country
  var byCountry = {};
  orders.forEach(function(r){
    var c = String(r[6]||'Unknown').trim();
    byCountry[c] = (byCountry[c]||0) + 1;
  });

  // By Print
  var byPrint = {};
  orders.forEach(function(r){
    var t = String(r[4]||'Unknown').trim();
    byPrint[t] = (byPrint[t]||0) + 1;
  });

  // By Month
  var byMonth = {};
  orders.forEach(function(r){
    var d = String(r[0]||'');
    // Date format: "July 9, 2026" — extract month+year
    var m = d.match(/([A-Za-z]+)\s+\d+,\s+(\d{4})/);
    var key = m ? m[1]+' '+m[2] : 'Unknown';
    byMonth[key] = (byMonth[key]||0) + 1;
  });

  // Revenue split by currency (USD for international, GHS for Ghana)
  // Smart parsing: commas = thousands separator, not decimal
  var usdRevenue = 0, ghsRevenue = 0;
  orders.forEach(function(r){
    var priceStr = String(r[7]||'').trim();
    if (!priceStr) return;
    var isUSD = priceStr.indexOf('$') !== -1;
    // Strip currency symbols, then remove commas (thousands sep), parse
    var numStr = priceStr.replace(/[^0-9.,]/g,'').replace(/,/g,'');
    var amount = parseFloat(numStr) || 0;
    // Sanity check: skip obviously wrong values (test data, pesewa amounts, etc.)
    // USD: expect $1–$2000, GHS: expect GH₵1–GH₵20000
    if (isUSD && amount >= 1 && amount <= 2000) { usdRevenue += amount; }
    else if (!isUSD && amount >= 1 && amount <= 20000) { ghsRevenue += amount; }
  });

  // Write summary
  var now = Utilities.formatDate(new Date(), 'Africa/Accra', 'MMMM d, yyyy HH:mm');
  var rows = [
    ['SUMMARY', 'Last updated: ' + now],
    ['', ''],
    ['Total Orders Sold', orders.length],
    ['Revenue Collected (USD)', '$' + usdRevenue.toFixed(2)],
    ['Revenue Collected (GHS)', 'GH₵ ' + ghsRevenue.toFixed(2)],
    ['', ''],
    ['ORDERS BY COUNTRY', 'Count'],
  ];
  Object.keys(byCountry).sort().forEach(function(k){
    rows.push([k, byCountry[k]]);
  });
  rows.push(['', '']);
  rows.push(['ORDERS BY PRINT', 'Count']);
  Object.keys(byPrint).sort().forEach(function(k){
    rows.push([k, byPrint[k]]);
  });
  rows.push(['', '']);
  rows.push(['ORDERS BY MONTH', 'Count']);
  Object.keys(byMonth).sort().forEach(function(k){
    rows.push([k, byMonth[k]]);
  });

  stats.getRange(1, 1, rows.length, 2).setValues(rows);
  stats.getRange(1,1).setFontWeight('bold').setFontSize(14);
  stats.getRange(6,1).setFontWeight('bold');
  stats.autoResizeColumns(1, 2);
  Logger.log('Stats tab updated: ' + orders.length + ' orders sold. USD: $' + usdRevenue.toFixed(2) + ' | GHS: GH₵ ' + ghsRevenue.toFixed(2));
}
