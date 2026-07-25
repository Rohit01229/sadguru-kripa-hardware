// Shared catalog-filter types + helpers usable from BOTH the server CatalogPage and
// the client CatalogFilters drawer. Intentionally NOT "use client": a pure function
// exported from a "use client" module becomes a client reference and cannot be invoked
// on the server (the RSC boundary error countActiveFilters hit when the server page
// called it).

export interface CategoryOption {
  /** Indented label so a category tree reads as a flat <select>. */
  label: string;
  value: string;
}

export interface BrandOption {
  label: string;
  value: string;
}

export interface CatalogFilterValues {
  q: string;
  categoryId: string;
  brandId: string;
  priceMin: string; // rupees, as typed
  priceMax: string; // rupees, as typed
  inStockOnly: boolean;
  sort: string;
}

/**
 * Count the filters the shopper has actually narrowed by (search box excluded — it has
 * its own field above the grid). Drives the mobile "Filters" Badge.
 */
export function countActiveFilters(v: CatalogFilterValues): number {
  let n = 0;
  if (v.categoryId) n += 1;
  if (v.brandId) n += 1;
  if (v.priceMin.trim()) n += 1;
  if (v.priceMax.trim()) n += 1;
  if (v.inStockOnly) n += 1;
  if (v.sort && v.sort !== "relevance") n += 1;
  return n;
}
