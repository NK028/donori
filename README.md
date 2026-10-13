# Donori · დონორი

A bilingual (Georgian / English) crowdfunding platform for a Georgian nonprofit. People submit fundraising requests, the nonprofit reviews them, and donors give by card, Apple Pay or Google Pay through **Bank of Georgia's** hosted payment page.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env      # optional, defaults work for testing
npm start                 # http://localhost:3000
npm test                  # end-to-end smoke test
```

It starts in **test mode** (`PAYMENT_PROVIDER=mock`), which uses a fake checkout page and moves no money. An admin account is created on first run from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, which default to `admin@donori.ge` / `change-me-now`.

## What it does

- **Browse and search** approved campaigns by category, with progress bars and donor counts.
- **Start a campaign:** signed-in users submit a title, story, goal, photo link, beneficiary and payout IBAN. Georgian IBAN format is validated.
- **Moderation:** new campaigns stay hidden until an admin approves them. Admins can reject a campaign with a reason or close it, and they can see every donation and its payment status.
- **Donate:** donors can give with or without an account, anonymously if they want, and can leave a message. They are sent to the bank's secure page, so card data never touches this server.
- **Payment safety:**
  - Callbacks are checked against BOG's RSA signature.
  - The status is then re-confirmed with the bank's receipt API and the amount is matched.
  - Duplicate or out-of-order callbacks can't double-count a donation.
  - Every callback is logged in `payment_events`.
- **Georgian/English** switch. Georgian is the default.
- **Installable on phones** as a PWA (add to home screen).

## Project layout

```
server.js            Express API + static files
db.js                SQLite schema, admin + demo seed
payments/index.js    picks the provider from PAYMENT_PROVIDER
payments/mock.js     test checkout (no money)
payments/bog.js      Bank of Georgia Payment Manager adapter
public/              front end (no build step): app.js, i18n.js, styles.css
test/smoke.js        end-to-end test
```

Adding a second provider, such as Flitt (TBC Group), means writing one more file with the same three functions (`createOrder`, `parseCallback`, `fetchStatus`).

## Switching to real payments (Bank of Georgia)

1. Request **sandbox credentials** at https://api.bog.ge/docs/en/payments/authentication.
2. Deploy the site on **HTTPS**, because BOG requires an HTTPS callback URL. Then set `BASE_URL`, `PAYMENT_PROVIDER=bog`, `BOG_CLIENT_ID` and `BOG_CLIENT_SECRET`.
3. In BOG Business Manager, enable **Apple Pay** and **Google Pay** for the merchant. They then appear automatically on the bank's payment page.
4. Make a test donation, check that the callback arrives and the donation turns `completed`, and test a refund.
5. Re-check the callback public key in `payments/bog.js` against BOG's docs.

## Before going live: things code can't solve

- **Legal setup:** the nonprofit needs a merchant agreement with the bank. Confirm with a Georgian lawyer how collecting money *for third parties* is treated, including charity/grant status, tax, and any licensing for holding and paying out funds.
- **Payouts:** decide how money reaches beneficiaries. Options are manual transfers after review, or BOG **split payments** to the campaign's IBAN. Also set a fee policy (`PLATFORM_FEE_PERCENT` is a placeholder and is not wired in yet).
- **Verification (KYC):** check the ID of people starting campaigns and get documents for medical or emergency claims before approval. This is the main fraud defence.
- **Policies:** terms of use, privacy policy (Georgian personal data law), refund policy, and a way for people to report campaigns.
- **Hardening:**
  - Change the admin password.
  - Add email verification and password reset.
  - Replace image links with real uploads to cloud storage.
  - Set up backups for the database (or move to Postgres).
  - Add a rate limiter that survives restarts.

## Mobile apps

The web app already works on phones and can be installed as a PWA. For App Store and Google Play listings, the quickest path is to wrap this front end with **Capacitor**. A rewrite in React Native is the longer path. Either way, keep payments on the bank's hosted page. Donations to a registered nonprofit can generally go outside Apple's in-app purchase system, but confirm against Apple's current App Review Guidelines before submitting.
