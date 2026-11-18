# Deployment guide (step by step)

Estimated time: about 45 minutes. You need an email address, a GitHub account, a Supabase account and a Vercel account (both free to start).

## 1. Create the database (Supabase)
1. Go to **supabase.com** → **Start your project** → create an organisation → **New project**.
   - Name: `globaltravelassi`. Region: choose the closest one to Algeria (for example Frankfurt or Paris).
   - Save the database password somewhere safe (password manager). You will rarely need it.
2. Wait until the project shows *Healthy*.

## 2. Create the tables, security and storage
1. In Supabase open **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_init.sql` from this project, copy everything, paste it into the editor and click **Run**. It should finish with *Success*.
3. Create a second query, paste `supabase/seed.sql`, and click **Run**. This adds the six starter services with *Price on request*.
4. Open **Storage** and check that a private bucket named `customer-documents` exists (created by the script).

## 3. Set authentication
1. **Authentication → Providers → Email**: keep *Email* enabled. Keep *Confirm email* turned **on** (recommended).
2. **Authentication → URL Configuration**:
   - **Site URL**: your website address, e.g. `https://www.globaltravelassi.com`
   - **Redirect URLs**: add `https://www.globaltravelassi.com/**` and, for testing, `http://localhost:3000/**`.
3. **Authentication → Email Templates**: optionally translate the confirmation and reset emails.

## 4. Get your public keys
In Supabase: **Project Settings → API**. Copy:
- **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Do **not** copy the `service_role` key. This application does not use it, and it must never be placed in the website.

## 5. Create your administrator account
1. On your website, click **Create account** and register with the email you will use as administrator. Confirm the email.
2. Back in Supabase **SQL Editor**, run (replace the email):

```sql
update public.profiles set role = 'admin' where email = 'your-admin@email.com';
```

3. Sign in on the website. You are taken to your admin area. Keep this account private.

## 6. Put the code online (Vercel)
1. Push this project to a GitHub repository (the `globaltravelassi` folder).
2. In **vercel.com** → **Add New… → Project** → select the repository.
3. **Root Directory**: choose `globaltravelassi` if the repository contains other folders.
4. **Environment Variables**, add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from step 4 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 4 |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | your WhatsApp number with country code and no `+`, e.g. `213555000111` |
| `NEXT_PUBLIC_SITE_URL` | your final address, e.g. `https://www.globaltravelassi.com` |

5. Click **Deploy**. When finished, open the address Vercel gives you.
6. **Settings → Domains**: add your own domain and follow the DNS instructions from your domain registrar.
7. Go back to step 3 and set the **Site URL** to your final domain.

## 7. Check before launch
- Open the site in Arabic, French and English on a phone.
- Register a test customer, submit a test request, upload a PDF, and check it appears in the admin area.
- In the admin area: change the status, record a test payment, download a document, export the CSV. Then delete the test request.
- Set real prices under **Services and prices**.
- Test the WhatsApp button.

## Updating later
Push changes to GitHub; Vercel redeploys automatically. Database changes are added as new SQL files in `supabase/migrations/` and run once in the SQL Editor.

## Troubleshooting
| Symptom | What to do |
|---|---|
| Site shows *Setup required* | Check the four environment variables in Vercel and redeploy. |
| Services are empty | Run `seed.sql`, or add services in the admin area and make sure *Shown on the website* is ticked. |
| Confirmation link opens a login error | Check the Site URL and Redirect URLs in step 3. |
| Admin area redirects to the dashboard | Run the SQL in step 5 with the correct email, then sign out and back in. |
| Upload fails | Only PDF, JPG and PNG files up to 10 MB are accepted. Check that the `customer-documents` bucket exists. |
| Reset link says expired | Links expire after a short time. Request a new one. |
