# Beauty B2B nail platform

V3 foundation for a bilingual professional nail products and private label website. English is served at `/`; Chinese is served at `/zh`. Earlier `/en` URLs redirect to their English equivalents.

## Run locally

Node.js 20.9+ and npm are required.

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run validate:mock
npm run build
```

The dev script uses filesystem polling for this macOS environment. The build script uses webpack because Turbopack's CSS worker could not bind its local port in the current sandbox.

## Architecture

| Path | Role |
| --- | --- |
| `src/app/(en)` | Explicit English App Router paths at `/` |
| `src/app/zh` | Mirrored Chinese paths at `/zh` |
| `src/features/pages` | Shared route templates and route data validation |
| `src/components/home` | Homepage sections assembled in the required V3 order |
| `src/components/cards` | Reusable category, product, collection and article cards |
| `src/lib/catalog/types.ts` | Category, product, variant, collection, attribute and RFQ types |
| `src/lib/catalog/taxonomy.ts` | Central category tree and category-specific attribute definitions |
| `src/lib/catalog/products.ts` | Catalog query functions and replaceable mock data source |
| `src/lib/catalog/mock-products.ts` | 24 bilingual mock products with variant-level MOQ and USD test prices |
| `src/lib/catalog/collections.ts` | Customer-intent collections, independent of categories |
| `src/lib/catalog/insights.ts` | Editorial topic previews, not published articles |
| `src/i18n` | English and Chinese UI dictionaries |
| `src/lib/site` | Locale paths, optional site URL and SEO metadata policy |
| `src/styles` | Design tokens and component, home and route styles |

Taxonomy uses `parentId` and `depth` to support three levels. Add a category to the central list, then use its parent ID; route and navigation links derive from that tree. Products share one model and use a flexible `attributes` record with category-specific definitions. Collections have their own `kind` and product references, so a style or audience can span categories.

The catalog has eight top-level categories. The Sprint 1 homepage keeps six fixed editorial category cards in `src/lib/site/home-category-entries.ts`, independently of the catalog count. The former `/products/nail-tools-care` route remains a non-indexable navigation page linking to Nail Tools and Nail Care. Moved category URLs redirect to their new paths in English and Chinese; category pages remain non-indexable until verified product content is available.

The 24 product records, collections and article topics are **concept data only**. `productCode` identifies a product family; only Variant `sku` identifies a purchasable specification. Variant MOQ and price-tier quantities use the same outer purchase unit, while optional `packageContents` describes what one pack or set contains. Customization-option MOQ is a separate constraint and does not replace Variant MOQ. These MOQ values, OEM/ODM capabilities and every USD price are illustrative test values, not supplier claims or quotations. Product images without a suitable local source are explicitly marked as placeholders. Run `npm run validate:mock` to check IDs, category and collection references, variant SKUs, MOQ, pricing tiers, images and bilingual fields. Replace all mock values with verified data before launch. RFQ is a route skeleton; it does not submit inquiries.

## SEO and deployment domain

Set `NEXT_PUBLIC_SITE_URL` in the deployment environment only when a real public domain is confirmed. Until then, pages are `noindex`, `robots.txt` disallows crawling and `sitemap.xml` is empty. With a real URL, the metadata helper emits absolute canonical and English/Chinese hreflang URLs plus base Open Graph fields. Only substantive pages are opted into indexing; concept product, collection, article and thin skeleton pages remain `noindex` until their content is verified. Update sitemap eligibility alongside those flags when pages become ready.

No database, CMS, authentication, payment, cart, admin interface or live RFQ backend is included in V3.
