/**
 * Scenario seed data for paper screenshots.
 *
 * Each scenario matches an episode in the UIST'26 paper (Section 5).
 * Data is seeded directly into the database to produce deterministic,
 * realistic screenshots without requiring LLM calls.
 */

import { field, structuredIntent } from "./helpers";

// ---------------------------------------------------------------------------
// Scenario 1: Paper Wholesaler Order Form (Episode 1)
// Principle in focus: all four design principles
// ---------------------------------------------------------------------------

export const ORDER_PORTFOLIO_ID = "a0000001-0001-4000-8000-000000000001";
export const ORDER_DWIGHT_ID = "a0000001-0002-4000-8000-000000000002";

export const orderPortfolio = {
  id: ORDER_PORTFOLIO_ID,
  title: "Client Order Form",
  intent: structuredIntent(
    "I need a client order form for our paper and office supply wholesale business. We use volume-based pricing with quantity breaks at 10, 50, and 100 cases. Products include copy paper, cardstock, envelopes, binders, pens and markers, and toner cartridges. We need to capture paper-specific attributes like weight class, brightness rating, and sheet size.",
    "Regional manager, office administrator, sales representatives",
    "Products should be identified using GS1 GTINs. Tax-exempt status should be stored as a client-level default with per-order override.",
  ),
  schema: {
    fields: [
      field("f1", "clientName", "Client Name", { kind: "text" }, { required: true, description: "Business name of the ordering client" }),
      field("f2", "purchaseOrderNumber", "Purchase Order Number", { kind: "text" }, { required: true, description: "Client's PO reference number" }),
      field("f3", "productCategory", "Product Category", {
        kind: "select",
        options: [
          { label: "Copy Paper", value: "copy-paper" },
          { label: "Cardstock", value: "cardstock" },
          { label: "Envelopes", value: "envelopes" },
          { label: "Binders", value: "binders" },
          { label: "Pens & Markers", value: "pens-markers" },
          { label: "Toner Cartridges", value: "toner" },
        ],
        multiple: false,
      }, { required: true }),
      field("f4", "productSku", "Product SKU (GTIN)", { kind: "text" }, { required: true, description: "GS1 Global Trade Item Number for the product" }),
      field("f5", "quantity", "Quantity (Cases)", { kind: "number", unit: "cases" }, { required: true }),
      field("f6", "quantityBreakTier", "Pricing Tier", {
        kind: "select",
        options: [
          { label: "1–9 cases (standard)", value: "standard" },
          { label: "10–49 cases (−5%)", value: "tier1" },
          { label: "50–99 cases (−12%)", value: "tier2" },
          { label: "100+ cases (−20%)", value: "tier3" },
        ],
        multiple: false,
      }, { required: true }),
      field("f7", "unitPrice", "Unit Price", { kind: "number", unit: "USD" }, { required: true }),
      field("f8", "paperWeightClass", "Paper Weight Class", {
        kind: "select",
        options: [
          { label: "20 lb (75 g/m²)", value: "20lb" },
          { label: "24 lb (90 g/m²)", value: "24lb" },
          { label: "28 lb (105 g/m²)", value: "28lb" },
          { label: "32 lb (120 g/m²)", value: "32lb" },
          { label: "65 lb cover", value: "65lb-cover" },
          { label: "80 lb cover", value: "80lb-cover" },
        ],
        multiple: false,
      }, { description: "Applicable for paper products only" }),
      field("f9", "paperBrightness", "Brightness Rating", { kind: "number", unit: "ISO" }, { description: "ISO brightness rating (e.g., 92, 96, 100)" }),
      field("f10", "sheetSize", "Sheet Size", {
        kind: "select",
        options: [
          { label: "Letter (8.5 × 11 in)", value: "letter" },
          { label: "Legal (8.5 × 14 in)", value: "legal" },
          { label: "Tabloid (11 × 17 in)", value: "tabloid" },
          { label: "A4 (210 × 297 mm)", value: "a4" },
          { label: "A3 (297 × 420 mm)", value: "a3" },
        ],
        multiple: false,
      }),
      field("f11", "deliveryAddress", "Delivery Address", { kind: "text" }, { required: true, description: "Full delivery address including dock/bay if applicable" }),
      field("f12", "deliveryDate", "Requested Delivery Date", { kind: "date" }, { required: true }),
      field("f13", "taxExemptStatus", "Tax-Exempt Status", { kind: "boolean" }, { description: "Client-level default; override per order if needed" }),
      field("f14", "taxExemptCertificate", "Tax-Exempt Certificate #", { kind: "text" }, { description: "Required when tax-exempt status is true" }),
      field("f15", "sustainabilityPreference", "Sustainability Preferences", {
        kind: "select",
        options: [
          { label: "FSC-certified paper only", value: "fsc" },
          { label: "Recycled content ≥ 30%", value: "recycled-30" },
          { label: "Carbon-neutral shipping", value: "carbon-neutral" },
          { label: "No preference", value: "none" },
        ],
        multiple: true,
      }, { description: "Client Acme Corp requested sustainability preferences for all future orders" }),
    ],
    groups: [],
    version: 1,
  },
};

export const orderDesignProbes = [
  {
    id: "c0000001-0001-4000-8000-000000000001",
    text: "Should product identification use GS1 Global Trade Item Numbers (GTINs)?",
    explanation: "GS1 GTINs provide a globally unique identifier for each product at each packaging level. Using GTINs enables interoperability with supply-chain systems, barcode scanning, and electronic data interchange.",
    layer: "dimensions",
    source: "standard",
    options: [
      { value: "acceptGtin", label: "Yes, use GS1 GTINs for product identification" },
      { value: "skipGtin", label: "No, use internal SKU codes" },
    ],
    dimensionName: "Product Identification Standard",
  },
  {
    id: "c0000001-0002-4000-8000-000000000002",
    text: "Should tax exemption be validated per order or stored as a client-level default?",
    explanation: "Some clients always order tax-exempt. Storing tax-exempt status at the client level reduces repetitive data entry while still allowing per-order overrides for mixed situations.",
    layer: "dimensions",
    options: [
      { value: "clientDefault", label: "Client-level default with per-order override" },
      { value: "perOrder", label: "Per-order validation only" },
    ],
    dimensionName: "Tax Exemption Scope",
  },
  {
    id: "c0000001-0003-4000-8000-000000000003",
    text: "Should the form capture sustainability and shipping preferences?",
    explanation: "Client Acme Corp has requested sustainability preferences for all future orders. Adding these fields enables tracking FSC certification, recycled content, and carbon-neutral shipping options.",
    layer: "intent",
    options: [
      { value: "addSustainability", label: "Yes, add sustainability preferences" },
      { value: "skipSustainability", label: "No, handle outside the form" },
      { value: "decideLater", label: "Decide later" },
    ],
    dimensionName: "Sustainability Tracking",
  },
];

export const orderProvenance = [
  { layer: "intent", action: "intent_updated", actor: "Michael (Regional Manager)", rationale: "Sections changed: purpose. Initial order form for paper and office supply wholesale business." },
  { layer: "configuration", action: "schema_generated", actor: "system", rationale: "Generated 12 fields from intent: client info, product selection, pricing tiers, delivery logistics.", diff: { added: [{ name: "clientName" }, { name: "productCategory" }, { name: "productSku" }, { name: "quantity" }, { name: "quantityBreakTier" }, { name: "unitPrice" }, { name: "paperWeightClass" }, { name: "paperBrightness" }, { name: "sheetSize" }, { name: "deliveryAddress" }, { name: "deliveryDate" }, { name: "specialInstructions" }], removed: [], modified: [] } },
  { layer: "dimensions", action: "standard_accepted", actor: "Michael (Regional Manager)", rationale: "Accepted GS1 GTIN standard for product identification. Products will use GTIN-14 codes.", diff: { added: [{ name: "productSku (GTIN)" }], removed: [], modified: [] } },
  { layer: "intent", action: "intent_updated", actor: "Pam (Office Administrator)", rationale: "Sections changed: purpose, constraints. Added purchase order number tracking and tax-exempt status fields." },
  { layer: "dimensions", action: "design_probe_resolved", actor: "Pam (Office Administrator)", rationale: '"Should tax exemption be validated per order or stored as a client-level default?" → "Client-level default with per-order override"', diff: { added: [{ name: "purchaseOrderNumber" }, { name: "taxExemptStatus" }, { name: "taxExemptCertificate" }], removed: [], modified: [] } },
  { layer: "intent", action: "intent_updated", actor: "Pam (Office Administrator)", rationale: "Client Acme Corp requested sustainability preferences for all future orders, effective 2026-04-01.", diff: { added: [{ name: "sustainabilityPreference" }], removed: [], modified: [] } },
];

// Dwight's derived sub-schema for field visits
const dwightFieldIds = ["f1", "f3", "f4", "f5", "f12"];

export const orderDwightFields = [
  field("f1", "clientName", "Client Name", { kind: "text" }, { required: true }),
  field("f3", "productCategory", "Product", {
    kind: "select",
    options: [
      { label: "Copy Paper", value: "copy-paper" },
      { label: "Cardstock", value: "cardstock" },
      { label: "Envelopes", value: "envelopes" },
      { label: "Binders", value: "binders" },
      { label: "Pens & Markers", value: "pens-markers" },
      { label: "Toner Cartridges", value: "toner" },
    ],
    multiple: false,
  }, { required: true }),
  field("f4", "productSku", "Product SKU", { kind: "text" }, { required: true }),
  field("f5", "quantity", "Quantity", { kind: "number", unit: "cases" }, { required: true }),
  field("f12", "deliveryDate", "Delivery Date", { kind: "date" }, { required: true }),
];

export const orderDwightPortfolio = {
  id: ORDER_DWIGHT_ID,
  title: "Client Order Form — Quick Capture",
  intent: structuredIntent(
    "I just need a quick order capture for client visits — client name, product selection, quantity, and delivery date. No pricing tiers, tax exemption, or billing details.",
  ),
  schema: { fields: orderDwightFields, groups: [], version: 1 },
  base_id: ORDER_PORTFOLIO_ID,
  projection: {
    type: "sub",
    scenarioIntent: "Quick order capture for client site visits on tablet",
    includedFieldIds: dwightFieldIds,
    additionalFields: [],
    fieldMappings: {},
  },
};

// ---------------------------------------------------------------------------
// Scenario 3: Quarterly Business Review (Episode 3)
// Principle in focus: Scenario-Driven Derivation
// ---------------------------------------------------------------------------

export const QBR_BASE_ID = "b0000001-0001-4000-8000-000000000001";
export const QBR_SALES_ID = "b0000001-0002-4000-8000-000000000002";
export const QBR_WAREHOUSE_ID = "b0000001-0003-4000-8000-000000000003";
export const QBR_CORPORATE_ID = "b0000001-0004-4000-8000-000000000004";

export const qbrBaseFields = [
  field("q1", "clientList", "Client List", { kind: "text" }, { required: true, description: "Active clients with account numbers" }),
  field("q2", "orderHistory", "Order History", { kind: "text" }, { required: true, description: "Order volume and value per client this quarter" }),
  field("q3", "revenueByCategory", "Revenue by Category", { kind: "text" }, { required: true, description: "Revenue breakdown: copy paper, cardstock, envelopes, binders, pens, toner" }),
  field("q4", "deliveryRecords", "Delivery Records", { kind: "text" }, { required: true, description: "On-time delivery rate, average lead time, exceptions" }),
  field("q5", "inventoryLevels", "Inventory Levels", { kind: "text" }, { required: true, description: "Current stock by SKU, reorder status" }),
  field("q6", "expenseCategories", "Expense Categories", { kind: "text" }, { required: true, description: "Operating expenses: warehouse, logistics, personnel, marketing" }),
  field("q7", "employeeActivityLogs", "Employee Activity Logs", { kind: "text" }, { description: "Attendance, productivity metrics, training completed" }),
];

export const qbrBasePortfolio = {
  id: QBR_BASE_ID,
  title: "Quarterly Business Review",
  intent: structuredIntent(
    "I need a quarterly business review form covering all our sales, operations, and financial data for Dunder Mifflin Scranton branch.",
    "Regional manager, sales reps, warehouse foreman, corporate supervisor",
  ),
  schema: { fields: qbrBaseFields, groups: [], version: 1 },
};

// Dwight's Sales Performance View (mixed: inherits some base + adds new)
const salesBaseFieldIds = ["q1", "q2", "q3"];

export const qbrSalesFields = [
  field("q1", "clientList", "Client List", { kind: "text" }, { required: true }),
  field("q2", "orderHistory", "Order History", { kind: "text" }, { required: true }),
  field("q3", "revenueByCategory", "Revenue by Category", { kind: "text" }, { required: true }),
  field("s1", "commissionRate", "Commission Rate", { kind: "number", unit: "%" }, { required: true, description: "Sales commission percentage this quarter" }),
  field("s2", "clientVisits", "Client Visits", { kind: "number" }, { description: "Number of in-person client visits this quarter" }),
  field("s3", "leadPipeline", "Lead Pipeline", { kind: "text" }, { description: "Active leads with estimated close dates and values" }),
  field("s4", "quarterOverQuarter", "Quarter-Over-Quarter Delta", { kind: "text" }, { description: "Clients who ordered less than last quarter for prioritized follow-up" }),
];

export const qbrSalesPortfolio = {
  id: QBR_SALES_ID,
  title: "Quarterly Business Review — Sales Performance",
  intent: structuredIntent(
    "Dwight's sales performance view: client list, order history, revenue, plus commission tracking, client visits, and lead pipeline. Need to see which clients ordered less for follow-up.",
  ),
  schema: { fields: qbrSalesFields, groups: [], version: 1 },
  base_id: QBR_BASE_ID,
  projection: {
    type: "mixed",
    scenarioIntent: "Sales representative view with commission and pipeline tracking",
    includedFieldIds: salesBaseFieldIds,
    additionalFields: qbrSalesFields.slice(salesBaseFieldIds.length),
    fieldMappings: {},
  },
};

// Darryl's Warehouse Operations View (sub: only operational slice)
const warehouseBaseFieldIds = ["q4", "q5"];

export const qbrWarehouseFields = [
  field("q4", "deliveryRecords", "Delivery Schedules", { kind: "text" }, { required: true, description: "Outbound delivery schedule and status" }),
  field("q5", "inventoryLevels", "SKU-Level Inventory", { kind: "text" }, { required: true, description: "Current stock per SKU with reorder points" }),
  field("w1", "reorderPoints", "Reorder Points", { kind: "text" }, { required: true, description: "Min stock thresholds triggering reorder" }),
  field("w2", "damageReports", "Damage Reports", { kind: "text" }, { description: "Damaged goods this quarter with incident details" }),
  field("w3", "barcodeScanner", "Barcode Scanner Input", { kind: "text" }, { description: "Scan GTIN barcode to look up item" }),
];

export const qbrWarehousePortfolio = {
  id: QBR_WAREHOUSE_ID,
  title: "Quarterly Business Review — Warehouse Operations",
  intent: structuredIntent(
    "Darryl's warehouse operations view: delivery schedules, SKU-level inventory, reorder points, and damage reports. Optimized for warehouse floor with barcode scanner integration.",
  ),
  schema: { fields: qbrWarehouseFields, groups: [], version: 1 },
  base_id: QBR_BASE_ID,
  projection: {
    type: "sub",
    scenarioIntent: "Warehouse floor view optimized for large input targets and barcode scanning",
    includedFieldIds: warehouseBaseFieldIds,
    additionalFields: qbrWarehouseFields.slice(warehouseBaseFieldIds.length),
    fieldMappings: {},
  },
};

// Jan's Corporate Oversight View (super: base + strategic metrics)
export const qbrCorporateFields = [
  ...qbrBaseFields,
  field("c1", "marketShareEstimates", "Market Share Estimates", { kind: "text" }, { required: true, description: "Regional market share by product category" }),
  field("c2", "competitorActivity", "Competitor Activity", { kind: "text" }, { description: "Notable competitor moves: pricing changes, new products, client wins/losses" }),
  field("c3", "expenseRevenueRatio", "Expense-to-Revenue Ratio", { kind: "number", unit: "%" }, { required: true, description: "Operating efficiency metric" }),
  field("c4", "complianceAuditResults", "Compliance Audit Results", { kind: "text" }, { description: "Internal audit findings and corrective actions" }),
];

export const qbrCorporatePortfolio = {
  id: QBR_CORPORATE_ID,
  title: "Quarterly Business Review — Corporate Oversight",
  intent: structuredIntent(
    "Jan's corporate oversight view: all base data plus market share estimates, competitor activity, expense-to-revenue ratios, and compliance audit results. Aggregated figures, not individual client details.",
  ),
  schema: { fields: qbrCorporateFields, groups: [], version: 1 },
  base_id: QBR_BASE_ID,
  projection: {
    type: "super",
    scenarioIntent: "Corporate supervisor view with strategic metrics and compliance",
    includedFieldIds: qbrBaseFields.map((f) => f.id),
    additionalFields: qbrCorporateFields.slice(qbrBaseFields.length),
    fieldMappings: {},
  },
};
