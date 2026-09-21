# Stage 1: structured label extraction

`POST /api/analyzeLabel` accepts multipart photo uploads for **one product**.
Send the Firebase ID token as `Authorization: Bearer <token>`. Existing tester
approval and per-user rate limits apply. The endpoint uses Gemini only; it does
not require Pinecone, change the chat endpoint, or save photos/product records.

Attach one to four JPEG, PNG, WebP, HEIC, or HEIF files, each below 8 MB. Photo
indices in evidence are zero-based upload order. No text fields are accepted.
For comparisons, call this endpoint separately for A and B; the client must
retain that grouping. Product-count detection is model-assisted and cannot
guarantee detection of every accidentally mixed upload.

Success is `{ "product": { "schemaVersion": 1, ... } }`. The executable contract
is `labelSchema` in `label-analysis.js`. All fields are required; unavailable
values are explicitly nullable. Every extracted fact includes evidence with
an image index and original text. References establish traceability, not proof
that OCR is correct; Stage 2 must allow visual review and correction.

- `panels` preserves each printed nutrition column and its preparation basis.
- `basis` distinguishes per 100 g, per 100 ml, per serving, per pack, and other.
- `basisQuantity` records the quantity applicable to that specific column.
- `servingSize` is the labelled serving; conflicting/ambiguous sizes should be
  null and described in `issues`, rather than collapsed to a guessed value.
- Nutrients retain their original units. Missing/unclear/conflicting values
  are null, with `unknown` qualifier. Trace is null with `trace` qualifier.
- Exact zero differs from missing. Less-than values retain their qualifier.
- Sodium and salt, and kcal and kJ, remain separate fields.
- Ingredients, declared allergens, precautionary statements, and claims keep
  the original language. No legal or health conclusions are generated here.

Stage 1 performs no portion calculation, unit conversion, product ranking,
persistence, or UI rendering. Stage 2 can render the validated record; Stage 3
can derive comparable values with explicit provenance. As-sold/dry/prepared
panels must not be combined blindly.

Responses: 400 invalid upload, 401 authentication, 403 tester access, 405 wrong
method, 429 app usage limit, 503 missing configuration or provider availability/quota,
502 other provider HTTP errors, 422 extraction failure or
unvalidated output, 500 unexpected internal failure. Extraction failures do
not expose provider payloads. Photos are processed in request memory only.

Run `npm --prefix functions test` from the repository root. Tests cover the
contract and upload parser using synthetic fixtures and a mocked model. They
do not establish real-photo extraction accuracy or verify the live provider.
Before release, run an authenticated emulator request against real labels and
manually check the output, including missing nutrients and multiple columns.

The Vite `/api` proxy already routes this function in the emulator. The Firebase
Hosting rewrite is added for deployment. Stage 1 is not yet called by the UI.
