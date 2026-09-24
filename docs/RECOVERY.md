# STRIDE recovery and migration

Recovered on 24 September 2026 from the owner’s ChatGPT Site, STRIDE — Fitness, for every body, https://stride-ghana.elkings.chatgpt.site.

- Site ID: `appgprj_6ab4b90874948191a426df2ce3f6e162`
- GitHub: https://github.com/Emmanuelok/terrastride
- Source version 4: `d8eaa820dbb6922f82bcc5f4beaf6a2d23111df0`
- Version 3: `cd4dc71f9642e0b2ef79136df26c649bea0733fc`
- Version 2: `b3daeff8c8c97c5525feb17152f3c6ce196a1ae5`
- Version 1: `2d9b1320cb267ea9a9581f0815df017ba1db8eff`

All four commits and the version-4 source were pushed to the destination repository. The original ChatGPT Site was owner-private. This migration preserves that saved source in Git history; the user requested a separate live deployment. The old Site’s access settings have not been altered.

The connected Sites database was read directly. Its five tables (`basket`, `saved`, `profiles`, `requests`, `plans`) each returned zero rows, no additional pages and no truncation. There were no customer records to migrate. The production environment-variable list was empty. The source manifest had D1 binding `DB` and no R2 binding. There were no source database exports or uploaded customer files in the recovered repository.

The original conversation, “Build fitness platform store”, records the initial catalogue, subsequent redesign and previous failed export attempts. The recovered commit corresponds to the latest Gadget/Throne-inspired redesign. Source inspection—not earlier chat claims—determines the implemented functionality below.

## Verified inventory

6,272 products, 22 departments, 153 populated categories, 266 brands, 13 source retailers/manufacturers. All 6,272 IDs and source product URLs are unique. See `data/catalogue-directory.md`, `data/catalogue-validation.json` and `data/sourcing-report.md` for detailed departments and sourcing.

Public routes: `/`, `/shop`, `/saved`, `/departments`, `/product/:id`, `/tools`, `/services`, `/account`, `/help`.

APIs: `GET /api/catalog`, `GET|POST /api/store`, `GET /api/export`.

Features: department/category navigation; search; brand and budget filters; sorting; pagination; product details and galleries; quick view; comparison of up to four items; persistent bags and favourites; contact/delivery profiles; quotation, service, business, support, return and supplier enquiries; request history; saved training plans; catalogue CSV export.

Training tools: workout builder, home-gym planner, plate calculator, interval timer and running-pace calculator. Service pages cover commercial gyms, home gyms, delivery/installation, schools/clubs, maintenance and product sourcing.

## Hosting changes

Production is a Vite-built React SPA plus one Cloudflare Worker. D1 stores shopping sessions and enquiries. Product photos are copied into Cloudflare R2 and served through the same origin at `/catalogue-images/…`; campaign artwork and the font use Worker Static Assets. Runtime infrastructure stays in one Cloudflare account. GitHub holds source and deployment configuration.

The standalone API ignores incoming ChatGPT identity headers. The original code trusted these because the Sites gateway supplied them; trusting them on a public Worker would allow impersonation. Shopping data now uses a random, HttpOnly, SameSite=Lax guest cookie, Secure on HTTPS, valid for 30 days. This is browser-local identity, not cross-device customer accounts. No verified customer sign-in flow existed in the recovered production app.

Original source image URLs remain in the catalogue and migration manifest for provenance. The production build maps all image and gallery references to the copied Cloudflare objects. The full manifest records original URL, destination, bytes, MIME and SHA-256. External source specification hyperlinks remain outbound references; the application does not fetch them to render its pages.

All 30,292 primary/gallery image URLs were recovered with zero failures, totalling 3,061,121,705 bytes. Every local file was checked against its recorded SHA-256 and byte length; source URL coverage and deterministic destination paths were also verified. The original catalogue data files remain unchanged.

The Cloudflare build fetches the original image URLs when no local recovery file is available. Some CDN responses differ from the recovered bytes; these are validated as the same raster format and logged as changed source renditions. R2 metadata distinguishes the original recovery hash from the actual hosted object's hash and size. The hosted image library therefore preserves the source URL coverage, but is not claimed to be byte-identical to the local recovery snapshot.

## Existing commercial limitations

STRIDE is a catalogue and enquiry application. It does not collect payment, confirm stock, notify staff, dispatch deliveries, or provide a merchant administration workflow. Prices are planning estimates, including fixed illustrative currency multipliers; they are not guaranteed selling prices. The UI retains these disclosures. Merchant inventory, prices, supplier arrangements and commercial policies require separate completion before taking orders.

The sourcing report mentions original raw feeds, research notes and a CSV deliverable that were not present in the saved source repository. The CSV can be regenerated from `/api/export`; the missing original research files have not been recovered. The two detailed source catalogue audits are retained as historical evidence, not a claim that every product has merchant-approved stock or pricing.
