# Administrator guide (no programming needed)

> **Historical, 19 November 2026.** This guide describes the first version, including payment tracking, which has since been removed. The current guide is [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).

Sign in at **yourdomain.com/ar/auth/login** (or `/fr/`, `/en/`). Your account must have the administrator role (see DEPLOYMENT.md, step 5). The **Admin** button appears in the admin area after sign-in. Switch language with AR / FR / EN at the top of the page.

## 1. Overview
Totals for all requests, requests this week, requests waiting for documents, customer accounts, payments received (per currency), and pending payments. The bars show how many requests are in each status.

## 2. Customers
- Every account that has registered, with its requests count.
- **Deactivate** blocks a customer from signing in (their data is kept). **Activate** restores access.
- Administrator accounts cannot be deactivated from this screen, and you cannot deactivate your own account.

## 3. Applications (requests)
Filter by status or search by name, email or reference (for example `GTA-2611-`).

Open a request to:
1. **Change status.** Choose the new status and optionally write a message. The customer sees the change, with your message, in their dashboard timeline.
   Statuses: New · In review · Documents required · Submitted to authority · Approved · Rejected · Completed · Cancelled.
   - Customers can upload or remove documents only while the status is *New* or *Documents required*. Once you move it to *In review* or later, uploads are locked. Move it back to *Documents required* if the customer must send more files.
2. **Check documents.** Download each file, then click **Mark as checked**. Customers see the "Checked by GLOBALTRAVELASSI" badge.
3. **Record payments.** Enter the amount, currency, method, the receipt or transfer reference, and the date received. Choose status *Received* only after the money has actually arrived. The total of *Received* payments is what appears in reports. Mark a payment *Cancelled* if it was a mistake. Nothing is confirmed automatically.
4. **Internal notes.** Visible to administrators only. Customers never see them.
5. **Delete request.** Removes the request, its documents and payments permanently. Use only for test or duplicate entries.

The **Customer contact** card has a WhatsApp button that opens a conversation with the customer, pre-filled with the reference.

## 4. Services and prices
- Add or edit a service in all three languages (titles and descriptions).
- **Price**: enter the amount the customer pays. Leave it empty to display *Price on request*.
- **Shown on the website**: untick to hide a service without deleting it. Services with requests cannot be deleted.
- **Display order**: lower numbers appear first.
- Changes appear on the website immediately.

## 5. Reports
- Requests and received payments per month.
- Requests per status and per service.
- Total received per currency.
- **Download Excel-compatible CSV**: one line per request, with the list of received payments. Open it in Excel or Google Sheets.

## Good habits
- Record a payment as *Received* only when you have the money or the bank confirmation.
- Keep customer documents only as long as needed for the request, and delete them when you are asked to.
- Never share your administrator password. Ask for a new password reset if in doubt.
- Ask a customer to contact you on WhatsApp for any change to a request after review has started.
