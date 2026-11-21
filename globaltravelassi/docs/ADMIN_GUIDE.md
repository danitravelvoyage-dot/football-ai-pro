# Admin guide

For the owner and the people the owner authorises. Admin access is for active accounts with the admin role. The role is set in the database, never from the website. Customers cannot see any of these pages.

## Sign in

Sign in at `/<locale>/auth/login` with the admin account. The dashboard is at `/<locale>/admin`.

## Overview

- **Total requests, new requests, in progress, approved, rejected, customers.** "In progress" counts requests under review. "Pending" (waiting for documents or submitted to the authority) is counted separately.
- **New requests waiting for review.** A banner shows how many requests have the status "new". Click it to see them.
- **Requests by status, by lead source, by service, by language.** Lead source counts show requests and customers per source. Conversion by source is **not measured**: the site does not count visits, so only request and customer counts are shown.

## Requests

Filter by status group, status, lead source, language, customer category, or search by name, email or reference.

Each request has:

- **Change status.** Statuses: new, in review, documents required, submitted to the authority, approved, completed, rejected, cancelled. The customer sees the status, your optional message, and receives an email for the decisions (documents required, approved, rejected, and the general update). Setting a request back to "new" sends no email.
- **Documents.** Open a file, then mark it as checked or unmark it. The customer receives an email for a review result.
- **Contact with the customer.** WhatsApp is manual: open the chat from the button, send your message yourself, then record the contact with the channel and an optional note. Nothing is sent automatically.
- **Lead source.** Shows where the request came from. To correct it, choose the source and give a reason. A recorded source changes only with a reason, and the change is kept in the activity log.
- **Customer category.** Standard, priority, returning customer or corporate.
- **Internal notes.** Visible to administrators only. Never shown to the customer.
- **Internal activity.** Source corrections, contacts, category and status changes. Entries are kept and cannot be edited or deleted.
- **Other requests from this customer.**
- **Delete request.** Refused, with nothing changed, if the request holds protected records. Use this only after the owner agrees.

## Customers

The list shows each account, its number of requests and the sources of those requests. An inactive account cannot sign in or submit anything.

## Services and prices

Each service has a title and description in three languages, a category, a price (or empty for "price on request") and an active flag. Inactive services are hidden from the site and their pages return not found. Two starter services that the business does not offer (European trips and travel consultation) are inactive by default.

## Reports and export

- **Reports** show requests by month, status, service, language and lead source.
- **Download CSV** exports every request with its lead source, campaign tag, category, language and last contact. Spreadsheet formulas are neutralised: a cell starting with `=`, `+`, `-`, `@`, tab or carriage return is stored as text.

The export contains customers' personal data. Keep the file private and delete it when you no longer need it.

## Customer emails

**Admin → Customer emails** shows every email the site has tried to send: the kind, the request, the recipient, the delivery status (pending, sent, failed, skipped), the attempts and a short error code.

- **Failed** emails can be retried (at most five attempts each). Sent emails are never sent again.
- **Pending** after a few minutes: the outcome is unknown, because the server may have stopped between sending and recording. It is not retried automatically. Contact the customer if it matters.
- **Skipped**: delivery is off or the account has no valid address.

## Language

Requests remember the language they were made in. Customer emails about a request use that language.

## Things the dashboard does not do

- No payments of any kind: no payment instructions, no proof upload, no payment confirmation.
- No WhatsApp messages are sent automatically. No WhatsApp API is used.
- No automatic email retry.
- No conversion rate by source (visits are not counted).
