# Order Workflow — Jeffery Asare Fine Art Prints
### From first click to final delivery and beyond

---

## STAGE 1 — THE BUYER DISCOVERS THE WORK

**What the buyer does:**
- Lands on jefferyasare.com (from Instagram, word of mouth, Google, etc.)
- Browses the portfolio and shop
- Clicks into a print they want — sees the image, sizes, pricing, and edition limit
- Reads the Terms of Sale

**What you do:**
- Nothing yet — the site does this automatically
- Your portfolio and pricing are live 24/7

---

## STAGE 2 — THE BUYER PLACES AN ORDER

**What the buyer does:**
- Selects a size (A3 / A2 / A1)
- Selects their country (determines shipping cost and delivery time)
- Enters their email address
- Clicks **"Buy Now →"** or **"+ Add to Cart"** → **"Checkout"**
- Completes payment via Paystack (card or mobile money)
- Receives a **payment confirmation** from Paystack immediately

**What happens automatically:**
- Paystack processes the payment and returns a unique order reference
- Your site sends the buyer an **Order Confirmation email** (via EmailJS, template: *Order Confirmation*)
  - Contains: print title, size, qty, price paid, order reference, next steps
- Your site sends **you an alert email** (via Formspree) with buyer name, items, price, country, order ref
- The buyer sees their **Certificate of Authenticity (COA)** on screen — they must enter their name before they can close it or save it as a PDF
- The COA email is sent to the buyer when they click "Print / Save as PDF"

**What you do:**
- Check your email for the order alert
- Log the order details (once Google Sheets is connected, this happens automatically)

---

## STAGE 3 — PRODUCTION

**What you do:**
- Confirm the order details (size, edition number, buyer's country)
- Send the print file to your printer
- Confirm print quality before signing
- Sign and number the print (e.g. "3/20")
- Package the print carefully (acid-free tissue, rigid backing, protective sleeve)

**What the buyer does:**
- Waits — they know from the confirmation email that production is 7–14 business days
- May send a follow-up inquiry (reply to their confirmation email or via the contact form)

**Timeline:** 7–14 business days after payment confirmation

---

## STAGE 4 — SHIPPING

**What you do:**
- Hand the package to DHL (or your courier)
- Get the tracking number from the courier
- Go to **jefferyasare.com/central-admin → Ship Order tab**
- Fill in: buyer email, buyer name, print title, DHL tracking number
- Click **"Send Tracking Email"**
  - The buyer receives a shipping notification with their tracking number and a link

**What the buyer does:**
- Receives the shipping notification email
- Tracks their package using the DHL link

**Timeline:** Send this email the same day you drop off the package

---

## STAGE 5 — DELIVERY

**What the buyer does:**
- Receives the package
- Opens it and inspects the print
- Contacts you within 48 hours if there is any damage (as per Terms of Sale)

**What you do:**
- If there's a damage report: arrange a replacement print, no charge
- If everything is fine: nothing yet — wait 3–5 days after the estimated delivery date

---

## STAGE 6 — FOLLOW-UP

**What you do (3–5 days after expected delivery):**
- Go to **central-admin → Follow-up tab**
- Fill in buyer email, name, print title
- Click **"Send Follow-up Email"**
  - This email checks in to confirm the print arrived safely and asks for feedback

**What the buyer does:**
- Replies to confirm safe arrival
- Optionally leaves a review or shares on social media (if prompted)

**Why this matters:**
- Confirms the print was received in good condition
- Creates an opportunity to ask for a testimonial or Instagram tag
- Opens the door for future purchases

---

## STAGE 7 — RETENTION (Keeping the buyer coming back)

**What you do (ongoing):**
- Add the buyer to your mailing list (if they consent)
- When you release new prints, send a personal note to past buyers first
- Use the **central-admin → Waitlist tab** to notify waitlisted buyers when a sold-out print becomes available

**What the buyer does:**
- If they had a great experience, they return when new work is released
- They recommend you to others
- Some buyers will collect multiple prints over time

---

## QUICK REFERENCE — YOUR ACTION CHECKLIST PER ORDER

| When | Your action | Tool |
|------|-------------|------|
| Order comes in | Check alert email, note order details | Email / Google Sheets |
| Print is ready (7–14 days) | Sign, number, package | Physical |
| Shipping day | Send tracking email | central-admin → Ship Order |
| 3–5 days post-delivery | Send follow-up email | central-admin → Follow-up |
| New work released | Notify past buyers | Email / Waitlist tab |

---

## AUTOMATED (happens without you)

- Order confirmation email → buyer ✅
- COA shown on screen + emailed on print → buyer ✅
- Order alert email → you ✅
- Paystack payment processing ✅
- Google Sheets order log (once SHEET_URL is configured) ✅

---

*Last updated: July 2026*
