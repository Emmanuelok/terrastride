# STRIDE Ghana

A health, sport and fitness catalogue and pre-launch commerce platform for Ghana.

The reference catalogue includes 6,272 normalized source product models in 22 departments and 153 populated categories. Every record retains its price source, currency, source product URL and associated photography. Prices and availability are explicitly references, not confirmed STRIDE inventory.

## Run and build

- `npm run dev`: full-stack Vinext development server using the installed Sites execution profile.
- `npm run build`: Vite React storefront and a directly bundled Cloudflare Worker. This avoids the environment's stalled RSC production analysis while preserving the same API modules and UI.
- `npm run db:generate`: generate Drizzle schema migrations after reviewed schema changes.

Production output is `dist/client` for assets and `dist/server/index.js` for the Worker; `dist/server/wrangler.json` describes logical DB and asset bindings. `.openai/hosting.json` retains the Sites identity. The platform assigns production infrastructure.

## Features

Department/subcategory navigation, source-brand and price filters, search, pagination, product detail galleries, four-item comparison, persistent bags and favourites, profiles, quote and service requests, customer request history, workout plans, home gym budget planning, plate calculator, interval timer, pace calculator and CSV export.

`components/store.tsx` and `components/tools.tsx` contain the interface. `app/api/` holds catalogue, export and persistent state APIs. `commerce/worker.ts` dispatches production requests. `data/` contains catalogue records, taxonomy, source notes and quality evidence. `db/schema.ts` and `drizzle/` define the durable storage.

## Launch status

Private pre-launch catalogue. Requests are saved, but not sent to suppliers or staff. No payment processor, live merchant inventory, fulfilment/courier or staff administration is connected. Contact methods, live selling prices, supplier permission for commercial images, regulated-product registration, delivery and returns/warranty policies need merchant confirmation before public trading. Do not introduce fake availability, reviews, discounts or delivery promises.

## Verification

TypeScript checks; complete catalogue ID/URL/category/provenance audits; 1,906 sampled image URLs; SQLite migration, ownership, quantity-upsert and request-idempotency checks. Browser preview was unavailable in this environment; full visual/browser validation remains outstanding.

## Commerce design references

The current visual edition is an original implementation informed by the public Gadget (Combine) and Throne (King) Shopify demos: spacious visual category navigation, paired campaign/product storytelling, rounded surfaces, and direct shopping controls. No commercial theme package, demo product content, or demo imagery is used. STRIDE keeps its own campaign imagery and sourced fitness catalogue.

- https://themes.shopify.com/themes/combine/presets/gadget
- https://themes.shopify.com/themes/king/presets/throne

Featured product carousel data is a small selection of existing catalogue records in `data/storefront-edit.json`. Collection tabs use the existing catalogue API.
