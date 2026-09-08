# TCSuite — Project Notes for Claude

School management platform for **The Creative School**. Django REST API backend (`backend/`) + Next.js App Router SPA (`frontend-next/`). Single-tenant, admin-only tool (no student/parent-facing login) for staff to manage enrollment and fee collection.

This file is my own orientation doc — written after reading the whole codebase — so I don't need to re-derive structure each session. `README.md` (setup/run instructions) already exists and is kept up to date separately; this file focuses on architecture, data model, and things worth remembering that aren't obvious from a quick glance.

## Stack

- **Backend:** Django 5 + Django REST Framework, `rest_framework_simplejwt` for auth, `django-cors-headers`, ReportLab for receipt PDFs, openpyxl for collection workbooks, PostgreSQL (via `psycopg2-binary`), `python-decouple` for env config.
- **Frontend:** React 19 + Next.js 15 (App Router) + Tailwind CSS 3, Axios, `react-hot-toast`, `framer-motion`, a single three.js scene on the login page. "The Registrar" design system — tokens and component classes in `frontend-next/app/globals.css`.
- **Dev servers:** Django on `127.0.0.1:8000` (`python backend/manage.py runserver`); Next on `localhost:3000` with `/api` and `/admin` proxied to Django (`frontend-next/next.config.mjs`, target overridable via `BACKEND_URL`).

## Repo layout

```
thcs/
├── backend/                  # every Django file lives here
│   ├── accounts/             # JWT login/refresh + admin profile (thin — 3 files matter)
│   ├── students/             # StudentProfile model, CRUD, class-grouped listing
│   ├── fees/                 # Everything fee-related: classes, years, structures,
│   │                         # records, misc charges, ledger, receipts (pdf.py),
│   │                         # collection workbooks (xlsx.py), balance sheets
│   ├── the_creative_school/  # Django project settings/urls (settings.py, urls.py)
│   └── manage.py, requirements.txt, .env / .env.example
├── frontend-next/            # Next.js 15 App Router SPA (replaced the Vite `frontend/`)
├── scripts/                  # generate_user_manual.py (Word doc generator, python-docx)
└── venv/                     # stays at the repo root — .vscode points at it and a
                              # virtualenv can't be relocated without rebuilding
```

`BASE_DIR` is now `backend/`, so `MEDIA_ROOT` is `backend/media`. `python-decouple`
walks up from `settings.py` to find `.env`, which is why `backend/.env` resolves.
`manage.py` works from the repo root (`python backend/manage.py …`) or from inside
`backend/` — Python puts the script's own directory on the import path either way.

Three Django apps, three matching git branches seen in history: `haroon-students-app`, `haroon-fee-app`, `haroon-accounts-app` (plus `main`). There's also a stray `.claude/worktrees/frontend-redesign-d2233b/` directory from a past agent worktree — appears to just mirror `main`, not obviously active work; check before assuming it holds unmerged changes.

## Data model (core relationships)

```
StudentProfile (students app)
  ├─ current_class (free-text, matched case-insensitively against ClassRoom.name)
  ├─ current_fee (optional per-student override of FeeStructure.monthly_fee)
  ├─ arrear_dues (charfield, parsed as int — used as previous_balance seed)
  └─ withdrawn ('yes'/'no')

ClassRoom (fees app)            — name, sort_order, is_active
AcademicYear (fees app)         — label, is_current (auto-unsets others on save)
FeeStructure (fees app)         — class_name (unique) → monthly_fee

FeeRecord (fees app)            — the central ledger row
  ├─ FK: student (PROTECT)
  ├─ unique_together: (student, month, year)
  ├─ receipt_no: auto-generated "YYYYNNNN" (8-digit), unique, never reused,
  │   resets to 0001 each calendar year (see generate_receipt_no() in fees/models.py)
  ├─ total_amount = previous_balance + current_fee + misc_charges  (computed in save())
  ├─ balance = total_amount - amount_paid                          (computed in save())
  ├─ status auto-derived on save() unless `_force_status` is set on the instance
  │   (unpaid / partial / paid / waived / advance)
  └─ is_advance flag for records created via the advance-payment flow

ChargeCategory (fees app)       — named misc-charge type with a default amount
MiscCharge (fees app)           — one-off charge per student/month/year, tied to a category;
                                   creating/deleting one recalculates FeeRecord.misc_charges
                                   for that student/month/year (see MiscChargeViewSet._update_fee_record_misc)

SavedBalanceSheet (fees app)    — JSON snapshot per year, upserted every time
                                   GET /fees/records/balance-sheet/ is called for that year
```

**Receipt display format:** stored as `YYYYNNNN` (e.g. `20260001`), shown to users as `YYYY-NNNN` via a `receipt_display` serializer field.

**Status logic subtlety:** `FeeRecord.save()` recomputes status from `amount_paid` vs `balance` on every save *unless* `instance._force_status` was set beforehand (used by `edit-record` and `advance-payment` to explicitly set `waived`/`advance`, which also zero out `balance`).

**Fee resolution order** when generating a record (bulk-generate, create, advance-payment): `student.current_fee` (per-student override) → `FeeStructure.monthly_fee` for `student.current_class` (case-insensitive... `class_name=` exact in create serializer, `iexact` in bulk-generate — inconsistent, worth normalizing if it causes bugs) → error if neither exists.

## Backend API surface

Base URL `http://127.0.0.1:8000`. All endpoints require `IsAdminUser` (JWT) by default except `/`, `/admin/`, and the login/refresh endpoints (see `REST_FRAMEWORK` / `SIMPLE_JWT` in `the_creative_school/settings.py`: access token 8h, refresh 1 day).

| Prefix | App | Router |
|---|---|---|
| `/api/accounts/` | accounts | `login/`, `refresh/`, `me/` (plain paths, not a router) |
| `/api/students/` | students | DRF router, single `StudentViewSet` + `by-class` action |
| `/api/fees/` | fees | DRF router: `classrooms`, `academic-years`, `structures`, `records`, `saved-balance-sheets`, `charge-categories`, `misc-charges` |

Notable non-CRUD actions, all on `fees/records/` (`FeeRecordViewSet`) unless noted:

- `lookup-receipt/?receipt=` — accepts full `20260001` or short `0001` (assumes current year)
- `bulk-generate/` (POST) — generate records for a whole class for one month/year, skipping students who already have one
- `advance-payment/` (POST) — prepay multiple months at once per student, forces status `advance`
- `record-payment/`, `edit-record/` (PATCH, detail) — two different serializers, `edit-record` allows forcing status
- `invoice/`, `invoice-pdf/` (detail) and `class-invoice/`, `bulk-invoices-pdf/` (list) — receipt PDFs live in `fees/pdf.py` (ReportLab); one receipt per student, four to an A4 page, arrears itemised by the month each is owed for, and a half-page receipt when that list is long. Invoice payloads are built by `invoice_payloads()` in `fees/views.py`, which batches the ledger breakdown onto each record.
- `class-collection-xlsx/` (list) — the class fee-collection sheet, an openpyxl workbook (`fees/xlsx.py`), not a PDF: staff mark payments against it and the totals row is live formulas. Replaced the former `class-invoice-pdf/`.
- `balance-sheet/`, `balance-sheet-pdf/` — computed live and **upserted into `SavedBalanceSheet` as a side effect of the GET** (worth remembering — this endpoint isn't read-only in effect)
- `top-defaulters/`, `distinct-years/`, `student-fee-history/`, `summary/`
- `fees/classrooms/{id}/with-fee-stats/`, `fees/classrooms/{id}/students-fee/`, `fees/classrooms/sync-from-students/` (creates ClassRoom rows from distinct `StudentProfile.current_class` values)

Serializer split pattern used throughout `fees/serializers.py`: separate `List`/`Detail`/`Create`/`Edit` serializers per model rather than one serializer with conditional fields — follow this convention when adding new endpoints.

## Frontend structure

```
frontend/src/
├── api/            # thin Axios wrappers, one file per domain (authApi, studentsApi, feesApi)
│   └── client.js   # baseURL '/api', attaches JWT, auto-refreshes on 401 once then redirects to /login
├── components/     # Layout, Sidebar, Modal, StatCard, Badge, ProtectedRoute
├── contexts/       # AuthContext (JWT + user profile), ThemeContext (light/dark, localStorage)
├── hooks/          # useYears.js
├── pages/
│   ├── Login.jsx, Dashboard.jsx
│   ├── students/   # Students (list+search+class filter), StudentForm, StudentDetail
│   └── fees/       # FeeDashboard, FeeStructures, FeeRecords, Classes, AcademicYears,
│                   # BalanceSheet, ChargeCategories, MiscCharges, InvoiceStudent, InvoiceClass
├── App.jsx         # route table
└── index.css       # ★ the whole design system (Tailwind layers, component classes)
```

Routing notes: `/fees/invoice/:id` and `/fees/invoice/class` render **outside** the `Layout` shell (print-first, standalone, always-light, auto-`window.print()`). Everything else is nested under `Layout` behind `ProtectedRoute`.

Auth flow: login → tokens in `localStorage` (`access_token`/`refresh_token`) → `AuthContext` fetches `/api/accounts/me/` to populate `user`. Axios interceptor in `api/client.js` retries once on 401 via `/api/accounts/refresh/`, else hard-redirects to `/login`.

For UI conventions (colour tokens, typography, component classes like `.panel`/`.btn-*`/`.badge`/`.ledger`, panel hover behaviour, page patterns, responsive breakpoints) — the live source of truth is **`frontend-next/app/globals.css`** (tokens in `:root`/`.dark`, components in the `@layer components` block) plus `frontend-next/tailwind.config.js`. There is no separate design document: the CSS is the spec.

## Things to double-check before relying on them

- `backend/.env` is present (git-ignored); `backend/.env.example` shows required keys: `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`.
- `StudentProfile.password` is a plain field hashed manually via `make_password()` in the serializer — there's no actual student-login view using it yet (`email`/`password` fields look forward-looking / unused by current API).
- Class name matching between `StudentProfile.current_class` (free text) and `ClassRoom.name` is done via case-insensitive comparison scattered across multiple views — not a FK. Renaming a `ClassRoom` won't cascade to students.

## Working-tree state

Effectively everything of substance is still uncommitted: `backend/ledger.py`'s
fee ledger, migrations 0004–0006, the whole `frontend-next/` app, and these docs
are untracked; the `backend/fees/*` modules are modified. Last commit is
`fea5a95 UI`, made before the backend move — so git still shows the old
root-level paths as deletions until the rename is committed.

Migration **`0006_customreceipt` is created but not applied** — run
`python backend/manage.py migrate` before using the New receipt flow.
