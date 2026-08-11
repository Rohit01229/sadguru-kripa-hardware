// Public surface of @hardware/core (framework-free domain logic).
export * from "./shared/errors";
export * from "./shared/money";
export * from "./shared/uom";
export * from "./shared/tax";
export * from "./shared/rbac";
export * from "./shared/logger";
export * from "./shared/types";
export * from "./shared/audit";
export * from "./shared/session";
export * from "./shared/r2";
export * from "./shared/cloudinary";
export * from "./billing/numbering";
export * from "./billing/service";
export * from "./inventory/service";
export * from "./ledger/service"; // re-exports ./ledger/schema (the ONE Zod surface)
export * from "./catalog/service"; // re-exports ./catalog/schema (the ONE Zod surface)
export * from "./catalog/defaults"; // starter units/category seeded on first product
export * from "./catalog/hsn"; // "Find HSN Code" lookup by item name
export * from "./catalog/barcode"; // Code 39 label generation + sheet geometry
export * from "./pricing/service";
export * from "./import/service";
export * from "./orders/service"; // re-exports ./orders/schema + ./orders/razorpay
export * from "./reports/service"; // re-exports ./reports/schema + ./reports/aggregate
export * from "./eway/service"; // e-way bill: rules, draft capture, portal payload
export * from "./salesdoc/service"; // estimates / proforma / delivery challans (21)
export * from "./expenses/service"; // shop money-out register (21b)
export * from "./shared/uqc"; // GST unit-quantity-code mapping
export * from "./settings/service"; // re-exports ./settings/schema
export * from "./dashboard/service";
export * from "./jobs/service";
export * from "./jobs/backup";
export * from "./platform/shops"; // tenant resolution (17 — multi-tenancy)
export * from "./platform/provision"; // P1 super-admin: provision/list/suspend shops
export * from "./platform/billing"; // P4 plans, subscriptions, limit enforcement
