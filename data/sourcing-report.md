# STRIDE catalogue sourcing report

Snapshot date: **24 September 2026**.

## Result

The published reference catalogue contains **6,272 normalized real product-model records** across **22 populated departments**, with **6,272 unique IDs**, **6,272 unique source product URLs**, and **6,272 unique exact brand/name pairs**. Product variants were never expanded into new catalogue rows. No products, source prices or source image URLs were invented.

The catalogue includes **3,088 records from Decathlon Ghana**, preserving real Ghana-cedi reference prices. Other reference products come from specialist retailers and manufacturers.

## Sources and coverage

Each source was fetched from its public first-party storefront product feed (`/products.json?limit=250&page=N`). The product page linked in each record is the direct original listing. Retailer catalogues include manufacturer-branded goods; a source listing does not establish a supply relationship with STRIDE.

| Source | Published models | Reference currency | Catalogue |
| --- | ---: | --- | --- |
| Decathlon Ghana | 3,088 | GHS | [Decathlon Ghana](https://decathlon.com.gh) |
| Northern Fitness | 1,005 | CAD | [Northern Fitness](https://www.northernfitness.ca) |
| SupplementSource.ca | 638 | CAD | [SupplementSource.ca](https://supplementsource.ca) |
| Ryderwear | 490 | USD | [Ryderwear](https://www.ryderwear.com) |
| Bells of Steel | 318 | CAD | [Bells of Steel](https://bellsofsteel.com) |
| Titan Fitness | 246 | USD | [Titan Fitness](https://titan.fitness) |
| Ability Superstore | 136 | GBP | [Ability Superstore](https://www.abilitysuperstore.com) |
| Canadian Protein | 112 | CAD | [Canadian Protein](https://canadianprotein.com) |
| Rehband | 111 | USD | [Rehband](https://eu.rehband.com) |
| Manduka | 84 | USD | [Manduka](https://www.manduka.com) |
| Amazfit | 35 | USD | [Amazfit](https://us.amazfit.com) |
| Ultima Replenisher | 5 | USD | [Ultima Replenisher](https://www.ultimareplenisher.com) |
| LMNT | 4 | USD | [LMNT](https://www.drinklmnt.com) |

Decathlon Ghana, Ryderwear, Manduka, Rehband, Amazfit, LMNT, Ultima Replenisher, Northern Fitness, Bells of Steel, SupplementSource.ca and Canadian Protein were paginated to completion. Titan was sampled through six 250-item pages; Ability Superstore through eight 250-item pages. Additional Decathlon US and Therabody feeds were researched but are not included, limiting duplicate overlap. Raw JSON source snapshots and currency responses are retained with the research files.

Storefront currency was checked using each relevant storefront’s `cart.js`. In particular, Bells of Steel returned **CAD**, and the Rehband Europe storefront returned **USD** for this session; neither was inferred from the domain.

## Prices and availability

`sourcePrice` and `sourceCurrency` preserve an actual listed positive source-variant price. For multi-variant items, this is generally the lowest positive listed variant; `specs.Reference option` identifies that option where the feed provides it. It does not price every size, capacity or bundle. Source prices may change.

`priceGHS` is explicitly marked `priceType: planning-estimate` for **every product**, including Ghana-sourced products. It is a prototype/reference amount, not an offer or a verified STRIDE selling price. GHS source amounts are retained. International values use the following deliberately fixed, illustrative conversion assumptions and are rounded up to the next GH₵5:

| Source currency | Planning multiplier to GHS |
| --- | ---: |
| GHS | 1 |
| USD | 12 |
| CAD | 9 |
| GBP | 16 |
| EUR (reserved; no final source uses it) | 14 |

These multipliers are **not claimed to be current exchange rates**. Estimates exclude freight, import duties, taxes, retailer margins, installation and other delivered-cost components. No STRIDE inventory, local stock, shipping commitment or brand-authorized dealership is asserted. Products unavailable at the source can remain as reference models.

## Model uniqueness and exclusions

The process kept one row per source product before further model grouping. It then collapsed obvious colour, size, weight/capacity and package/flavour versions. Ryderwear colour pages were grouped by apparel model and gender. Decathlon names were normalized using source colour tags and obvious weight/size suffixes. Equipment families were deduplicated using normalized brand/model keys, followed by manual review of weight-only variants, bundles, builders and source duplicates. Final global checks remove identical brand/model names and source URLs.

Gift cards, insurance, shipping/service lines, configuration builders, subscriptions, repeated bundles, damaged/sample promotions, and unrelated household, fishing, hunting and equestrian products were removed. The supplement audit excluded topical cosmetics/oils, colloidal silver and one stimulant formula pending ingredient verification. No CBD, SARMs, anabolic hormones, prescription medicines or administrative line items were identified in the reviewed published records. Descriptions in the final catalogue do not reproduce retailer medical or performance claims.

Deduplication combines deterministic rules and targeted review; semantic equivalence between differently named models is not exhaustively hand-certified. Counts represent normalized model records with real source provenance, not independently validated global manufacturer SKUs.

## Images and brand treatment

Every published row uses a product-image URL supplied by its original storefront feed; the `images` array preserves up to six source images. No image URLs were synthesized from product names, and no product images or brand logos were generated. Images remain source-supplied third-party catalogue imagery. Source snapshots preserve the product-to-image association.

HTTP HEAD verification returned valid image responses for **1,906 unique primary image URLs** in a large partial set and a source-stratified sample (at least 20 per source where available). **0 tested published product images failed.** Reachability was not tested for every URL; all published image URLs were nevertheless verified against their source feed records. These external URLs can change after this snapshot.

## Coverage and limits

All 22 requested/planned departments contain real items. Strong coverage includes strength equipment, women’s and men’s apparel, footwear, cycling, swimming, cardio, protein, vitamins, yoga, recovery and team/racket/combat sports. Fitness tech has Amazfit watches, basic sports watches, heart-rate monitors and audio accessories; this is not an exhaustive Garmin/Apple/Polar catalogue. Ghana inventory availability for imported specialist products is unverified. The sources do not establish actual Ghana procurement, warranty service or compliant import eligibility for any specific product.

Adaptive movement retains real exercise/boccia products and functionally distinct wheelchairs, walkers, rollators and crutches. It does not imply that all mobility aids are sports-specific. General household goods, novelty accessories, colour-only mobility pages and ordinary yoga/balance products were removed or reassigned. Commercial gym facilities currently cover storage, flooring and gym accessories; full architectural/installation services are not listed as invented products.

## Deliverables

- `products.json` — complete application catalogue.
- `departments.json` — populated department, category and count directory.
- `stride-fitness-catalogue.csv` — spreadsheet-friendly full catalogue with provenance.
- `catalogue-directory.md` — department/category/source product counts.
- `catalogue-validation.json` — exact uniqueness and category checks.
- `image-verification-final.json` — empirical URL-check results.
- `raw/` and `notes/` — original feeds, currency snapshots and audit decisions.
