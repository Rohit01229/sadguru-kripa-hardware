// Small shared domain types used across modules.
export type Id = string;

/** A line as chosen at the counter / storefront, before pricing/tax. */
export interface SaleLineInput {
  productId: Id;
  saleUnitId: Id;
  saleQty: string; // Decimal as string at the transport boundary
}
