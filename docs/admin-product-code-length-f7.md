# Sprint 2.6-B4-A-F7: Product Code URL boundary decision

Status: **F7 historical risk and design record; F8 approved and implemented B + C.** The measurements below reproduce the former Product Code URL and V1 cursor limits. Current Admin list links use the read-only UUID detail route and new requests issue compact HMAC-SHA256 V2 cursors. These are local/offline results, not production or real Supabase acceptance.

## Existing contract

- The foundation migration stores `catalog_private.products.product_code` as `text NOT NULL UNIQUE` and checks only nonempty, `btrim`-stable text. It has no byte or character length cap; uniqueness is case-sensitive. The migration has not been edited.
- Sprint 2.5 CSV parsing limits one field to 32,768 JavaScript UTF-16 code units and the file to 2 MiB. Import validation rejects empty, leading/trailing whitespace and C0 controls. CSV must be valid UTF-8. SQL permits some text that import rejects; the F6 read validator also rejects all Unicode `Cc` controls. No import rule was changed.
- The B1 Product Code lookup accepts up to 32,768 UTF-16 code units. F6's encoded Product Code route and ordinary ASCII route remain available for legacy links, with page and Repository `catalog.read` checks. Very long legacy Product Code URLs can still exceed browser or proxy limits; current list links instead use `/admin/products/id/[productId]`. V2 signs a fixed-size UUID boundary reference and caps the encoded cursor at 1,024 characters; the list URL parser uses the same cap. The validated `returnTo` path is capped at 2,048 characters and falls back to `/admin/products` if longer.
- Product Code is a family identity; Variant SKU is separate. Public product SEO uses its own slug route and is outside this decision.

## Length measurements

The F7 offline test `scripts/test-admin-products-query.mjs` exercised 128, 256, 512, 1,024, 2,048, 4,096, 8,192 and 32,768 UTF-16 code units for ASCII, Chinese, combining Unicode, slash, percent and internal spaces. All 48 synthetic codes passed the then-current CSV parser, Repository detail lookup, canonical path round-trip, V1 cursor issue/verify, Next and Previous. These are historical in-process results, **not current V2 URL lengths or browser delivery evidence**.

| Code units | ASCII UTF-8 bytes | ASCII detail URL | ASCII signed list URL | Chinese UTF-8 bytes | Chinese detail URL | Chinese signed list URL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 128 | 128 | 144 | 406 | 384 | 536 | 747 |
| 256 | 256 | 272 | 576 | 768 | 1,048 | 1,259 |
| 512 | 512 | 528 | 918 | 1,536 | 2,072 | 2,283 |
| 1,024 | 1,024 | 1,040 | 1,600 | 3,072 | 4,120 | 4,331 |
| 2,048 | 2,048 | 2,064 | 2,966 | 6,144 | 8,216 | 8,427 |
| 4,096 | 4,096 | 4,112 | 5,696 | 12,288 | 16,408 | 16,619 |
| 8,192 | 8,192 | 8,208 | 11,158 | 24,576 | 32,792 | 33,003 |
| 32,768 | 32,768 | 32,784 | 43,926 | 98,304 | 131,096 | 131,307 |

These historical V1 URL lengths are from the tested code shape and query. Combining characters, JSON escapes and extra filters can change the exact size. Current V2 cursors no longer contain Product Code. `returnTo` resets a long list URL to `/admin/products` once its validated path exceeds 2,048 characters.

## Isolated browser and PostgreSQL evidence

The isolated Next.js development site returned HTTP 200 for detail URLs through 8,192 ASCII characters and through 2,048 Chinese characters. The browser reported `ERR_HTTP_RESPONSE_CODE_FAILURE` for 4,096 and 8,192 Chinese characters and for 32,768 ASCII or Chinese characters. A signed `product_code_asc` Next URL worked at 2,048 Chinese characters (8,427-character URL) and failed at 4,096, 8,192 and 32,768 Chinese characters (16,619; 33,003; 131,307 characters). This confirms a real transport boundary in the isolated stack, not a Repository validation failure. It does **not** establish a universal browser or production proxy limit.

In the dedicated PostgreSQL 17.11 cluster, the read-only Repository successfully retrieved a 32,768-character Chinese code and paged between two such synthetic draft rows in both directions. The test temporarily inserted its two rows and removed only those rows after checking the fixed local data directory; the baseline catalog remained at nine products. The test-only cleanup bypassed the foundation's soft-delete trigger inside the dedicated cluster. No production migration or database was changed.

## Options considered at F7

| Option | Compatibility and safety | Complexity / migration | Public SEO |
| --- | --- | --- | --- |
| A. Limit Product Code URLs or import length | Short requests, but rejects currently legal imports and may strand stored products; cannot meet the compatibility goal alone. | Small code change; potentially large data/contract migration. | No direct route change, but products may become unmanageable. |
| B. Admin detail by UUID | Short route; use the existing product UUID as a locator while continuing to display and preserve Product Code as business identity. Require `catalog.read` at page and Repository and query one product by bound UUID. Keep legacy code route for compatibility. | New read-only Repository/source method and route; no schema migration expected. Requires approval. | No change. |
| C. Compact, stateless signed code-sort cursor | HMAC payload carries version, Admin scope, sort, filter, direction and boundary UUID, not the long Product Code. After authorization and verification, the read source resolves the immutable Product Code by UUID inside the same read-only snapshot, then applies the existing Product Code + UUID keyset comparison. Preserve Next/Previous semantics and reject a missing or invalid boundary. | New cursor version and bounded source lookup; old signed cursors need an explicit compatibility/expiry policy. No cursor table or server-side state required. Requires approval and offline/PostgreSQL/browser regression. | No change. |

**Recommendation:** combine B and C. This retains existing Product Codes and import rules, avoids long request URLs and avoids new database state. UUID is only an Admin locator or signed boundary reference, never a replacement for Product Code ordering or business identity. The new source lookup must remain read-only and use the same `catalog.read` boundary; a valid signature cannot substitute for authorization. The PostgreSQL Product Code immutability guard supports stable boundary resolution, but concurrent updates and filter changes still require explicit tests. No Public route or projection should be changed.

## F8 resolution and remaining gate

F8 implemented the Admin UUID detail Repository API and `/admin/products/id/[productId]` route, while retaining the Product Code routes for compatible legacy links. F8 also implemented V2 with HMAC-SHA256, constant-time verification, Admin scope, query/sort/direction binding, a UUID boundary reference and a 1,024-character limit. The read source resolves the boundary by UUID after authorization and signature verification; Product Code ordering still uses Product Code plus UUID. The boundary witness rejects missing or changed boundary products and filter mismatches. Existing V1 links are **rejected immediately**, with no acceptance grace period or unsigned fallback; users must reopen the list from page one. Local offline, PostgreSQL and isolated browser tests cover these paths. Separate requests do **not** share a database snapshot, so concurrent changes to other rows may still alter pagination. Legacy Product Code URLs remain subject to transport length limits. Production proxy limits, real Supabase identity and deployment behavior remain unverified.
