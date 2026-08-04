-- Bill theme (docs/architecture/19 §7) — per-shop look-and-feel for printed bills:
-- accent, font, size, density, table borders, and which optional blocks appear.
-- Nullable: a shop with no saved theme renders the documented defaults, so this is a
-- pure add with no backfill and no behaviour change until someone opens the editor.
-- Cosmetic only — GST-mandatory elements are not expressible as hideable in the config.
ALTER TABLE "StoreConfig" ADD COLUMN "billTheme" JSONB;
