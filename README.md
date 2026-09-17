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

- Current limits are defined in `functions/index.js`: 10 requests per rolling
  10-minute window and 30 requests per Malaysia calendar day.

