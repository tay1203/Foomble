# Foomble

An AI food-label assistant for understanding packaged food, nutrition information,
and questions about Malaysian food regulations. Upload label images or ask a
question in the chat.

[Open Foomble](https://food-label-a679e.web.app) ·
[GitHub repository](https://github.com/tay1203/Foomble)

The app is currently in a testing phase. Google sign-in and a shared tester
access code are required.

## Features

- Chat about food labels and nutrition, with support for up to four label images
  per request (8 MB per image).
- Gemini-powered image understanding and responses.
- Retrieval from a Pinecone index for questions about Malaysian food regulations.
- Google authentication, a server-validated tester access code, and per-user
  request limits stored in Firestore.
- A React 19 and TypeScript interface styled with Tailwind CSS and Radix UI.

## Architecture

Foomble is a React/Vite web app hosted on Firebase Hosting. Firebase
Authentication identifies each tester, Cloud Functions validates the shared
testing passcode and applies per-user limits, and the backend calls Gemini and
Pinecone. Browser clients never receive the AI, Pinecone, or testing-code
secrets.

## Project layout

```text
food-label/     React app, Firebase web configuration, and UI
functions/      authenticated API, access gate, rate limits, AI integration
scripts/        Windows-safe emulator launcher
public/         food regulations PDF and sample food-label images
firebase.json   Hosting rewrites, Functions, Firestore rules, emulators
```

## Prerequisites

- Node.js 22 and npm.
- Java for the Firestore emulator.
- A Firebase project with Google authentication, Firestore, and Cloud Functions.
- Gemini API access and a populated Pinecone index.

Clone the repository, then install dependencies:

```bash
git clone https://github.com/tay1203/Foomble.git
cd Foomble
npm ci
npm --prefix food-label ci
npm --prefix functions ci
```

The configuration currently targets the original Firebase project
`food-label-a679e`. If you use your own project, update `.firebaserc`, the proxy
target in `food-label/vite.config.ts`, and your local environment files.

## Before you deploy

1. Use the Firebase project in `.firebaserc` (`food-label-a679e`) and make sure
   your account can deploy to it. Cloud Functions deployment normally requires
   the Blaze plan.
2. In **Firebase Console → Authentication → Sign-in method**, enable Google.
   In **Authentication → Settings → Authorized domains**, add your final
   Hosting/custom domain. Add `localhost` too if you use local Vite development.
3. In the Gemini project that owns your API key, confirm the selected billing
   tier has usable quota. A Gemini `429` saying *prepayment credits are
   depleted* is an upstream account/billing condition, not this app's rate
   limiter.
4. Create the four production Firebase secrets from the repository root. The
   prompts safely accept each value without writing it to source control:

   ```bash
   npx firebase-tools login
   npx firebase-tools use food-label-a679e
   npx firebase-tools functions:secrets:set GEMINI_API_KEY
   npx firebase-tools functions:secrets:set PINECONE_API_KEY
   npx firebase-tools functions:secrets:set PINECONE_INDEX_NAME
   npx firebase-tools functions:secrets:set TEST_ACCESS_CODE
   ```

5. Copy `functions/.env.example` to
   `functions/.env.food-label-a679e`, then set `ALLOWED_ORIGIN` to the exact
   public URL users will visit. For the default Firebase Hosting address, leave
   it as `https://food-label-a679e.web.app`. This limits Function CORS in
   production; it is deliberately not a secret.
6. Copy `food-label/.env.example` to `food-label/.env.local` and set the
   Firebase web app values from **Project settings → Your apps**. These values
   are public client configuration, but the API key should still be restricted
   in Google Cloud Console to your web domains and the Firebase APIs it needs.

## Local development

Install the two application dependency sets once:

```bash
npm --prefix food-label ci
npm --prefix functions ci
```

For emulator secrets, copy `functions/.secret.local.example` to
`functions/.secret.local` and fill in real values. Do not commit the completed
file. Start Firebase and Vite in separate terminals:

```bash
# Terminal 1, from the repository root
npm run emulators

# Terminal 2
npm --prefix food-label run dev
```

Vite forwards `/api/*` to the Functions emulator. Firebase Hosting rewrites
those same API paths to the deployed Functions in production.

Open the local URL printed by Vite. Authentication uses the configured Firebase
project; this setup does not enable the Authentication emulator.

## Research utilities

`functions/ingest.py` loads the regulations PDF and prepares vectors for
Pinecone. `functions/test/` and `functions/urop_test.ipynb` contain research
experiments for extraction, retrieval, and evaluation. These are separate from
the web app build and may call paid APIs or write to Firestore/Pinecone.

The Python utilities need their own Python dependencies and data-path
configuration; some currently use absolute Windows paths. Set `GEMINI_API_KEY`
and `PINECONE_API_KEY` as needed. For Firebase Admin and Cloud Vision, configure
`GOOGLE_APPLICATION_CREDENTIALS` to point to a local service-account file.
Keep that file outside source control. The ingestion script currently targets
the `food-label-app` index; use the same index for `PINECONE_INDEX_NAME`.

## Release checks and deployment

Run the checks from the repository root:

```bash
npm run build
npm run lint
```

Then deploy Hosting, Functions, and Firestore configuration together:

```bash
npm run deploy
```

The first command builds the browser app. The second runs actual React/TypeScript
linting and validates Function syntax. The deployment command repeats both
checks and runs the Firebase deploy. It does not publish local `.secret.local`
or `.env.local` files.

After Firebase prints the Hosting URL, open it in an incognito window and test:

1. Google sign-in works and the shared test code unlocks the chat.
2. An unapproved signed-in user is returned to the access screen.
3. A label upload and a text question receive a response.
4. The 11th request within ten minutes receives the stated retry time.
5. Sign out, sign back in, and verify the gate and limits remain tied to the
   Google account.

## Operating the testing phase

- To replace the shared passcode, run
  `npx firebase-tools functions:secrets:set TEST_ACCESS_CODE`, enter the new
  value, then deploy Functions (`npm run deploy` is simplest).
- Approved tester records and rate-limit counters are stored server-side in
  Firestore by Firebase UID. To revoke an individual tester or reset their
  testing usage, remove the relevant documents through a controlled admin tool
  or the Firebase Console. The browser's Firestore rules intentionally deny
  direct access.
- Current limits are defined in `functions/index.js`: 10 requests per rolling
  10-minute window and 30 requests per Malaysia calendar day. Change those
  constants, review the impact, and redeploy Functions to alter the policy.

## Important security boundary

Do not put `GEMINI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, or
`TEST_ACCESS_CODE` in a Vite `VITE_*` variable, the frontend, or a Git commit.
Only Firebase Functions use them. Firebase web configuration is expected to be
visible in the browser; the security comes from Authentication, authorized
domains, API-key restrictions, Firestore rules, server-side passcode checking,
and server-side rate limiting.
