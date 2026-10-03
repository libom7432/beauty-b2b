# B2B Beauty Site

Sprint 0 foundation for a bilingual B2B beauty website serving Western markets, with the US as the first priority. English is the default language. Press-on nails and false eyelashes are the first planned product categories.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, ESLint
- npm and Git
- No database, authentication, commerce platform, or third-party i18n package yet

## Getting started

Requires Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to be redirected to `/en`. `/zh` serves Chinese. Run `npm run build`, `npm run lint`, and `npm run typecheck` for verification.

The dev script enables filesystem polling because native file watching hit the open-file limit in the current macOS development environment.

## Directory map

| Path | Purpose |
| --- | --- |
| `src/app/[locale]` | Localized App Router pages and layout; `/en` and `/zh` |
| `src/app/api` | Reserved for future API routes; no endpoint exists |
| `src/i18n` | Supported locales and small typed dictionaries |
| `src/features/products` | Reserved for product features |
| `src/features/categories` | Reserved for category features |
| `src/features/wholesale` | Reserved for wholesale features |
| `src/features/private-label` | Reserved for private label features |
| `src/features/rfq` | Reserved for request for quotation features |
| `src/features/sample-request` | Reserved for sample request features |
| `src/features/admin` | Reserved for future admin features; none implemented |
| `src/lib/database` | Reserved for future database integration; none configured |

The reserved directories contain only `.gitkeep` files. Add code when a feature enters scope.

## Environment

Sprint 0 requires no environment variables. `.env.example` documents that state and provides a place to add future variables.
