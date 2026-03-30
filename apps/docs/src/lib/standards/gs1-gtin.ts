import type { DomainStandard } from "../domain-standards";

export const gs1Gtin: DomainStandard = {
  id: "gs1-gtin",
  name: "GS1 Global Trade Item Numbers (GTINs)",
  domain: "commerce",
  version: "GS1 General Specifications 24.0",
  description:
    "GS1 identification standard for trade items. Defines GTIN formats (GTIN-14, GTIN-13/EAN), product attributes, and packaging hierarchy for supply-chain data collection.",
  url: "https://www.gs1.org/standards/barcodes/gtin",
  keywords: [
    "gtin",
    "gs1",
    "ean",
    "upc",
    "barcode",
    "product",
    "sku",
    "wholesale",
    "order",
    "supply",
    "inventory",
    "catalog",
    "trade item",
    "product identification",
    "supply chain",
  ],
  fieldConstraints: [
    {
      fieldKey: "gtin14",
      label: "GTIN-14",
      type: "string",
      required: "mandatory",
      description:
        "14-digit Global Trade Item Number identifying the trade item at a specific packaging level.",
      validationRules: {
        pattern: "^\\d{14}$",
      },
      standardReference: "GS1 GTIN-14 (AI 01)",
    },
    {
      fieldKey: "gtin13",
      label: "GTIN-13 / EAN",
      type: "string",
      required: "recommended",
      description:
        "13-digit trade item number used at point-of-sale. Also known as EAN-13.",
      validationRules: {
        pattern: "^\\d{13}$",
      },
      standardReference: "GS1 GTIN-13 (EAN-13)",
    },
    {
      fieldKey: "productDescription",
      label: "Trade Item Description",
      type: "string",
      required: "mandatory",
      description:
        "Human-readable description of the trade item, following GS1 naming conventions.",
      standardReference: "GS1 Trade Item Description",
    },
    {
      fieldKey: "brandName",
      label: "Brand Name",
      type: "string",
      required: "mandatory",
      description: "The brand under which the trade item is marketed.",
      standardReference: "GS1 Brand Name",
    },
    {
      fieldKey: "packagingLevel",
      label: "Packaging Level",
      type: "select",
      required: "recommended",
      description:
        "The level at which the item is packaged for identification and ordering.",
      codeSystemId: "gs1-packaging-level",
      validationRules: {
        options: ["Each", "Inner Pack", "Case", "Pallet"],
      },
      standardReference: "GS1 Packaging Level",
    },
    {
      fieldKey: "netContent",
      label: "Net Content",
      type: "number",
      required: "recommended",
      description: "The net quantity of the product in the specified unit of measure.",
      standardReference: "GS1 Net Content (AI 310x–360x)",
    },
    {
      fieldKey: "netContentUom",
      label: "Net Content Unit of Measure",
      type: "select",
      required: "recommended",
      description: "Unit of measure for the net content value.",
      codeSystemId: "gs1-uom",
      validationRules: {
        options: ["kg", "g", "lb", "oz", "L", "mL", "m", "cm", "ea", "sheet", "ream"],
      },
      standardReference: "GS1 Net Content UoM",
    },
    {
      fieldKey: "countryOfOrigin",
      label: "Country of Origin",
      type: "string",
      required: "optional",
      description: "ISO 3166-1 alpha-2 country code where the product was manufactured.",
      validationRules: {
        pattern: "^[A-Z]{2}$",
      },
      standardReference: "GS1 Country of Origin",
    },
    {
      fieldKey: "targetMarket",
      label: "Target Market",
      type: "string",
      required: "optional",
      description:
        "ISO 3166-1 alpha-2 country code of the intended market for the trade item.",
      validationRules: {
        pattern: "^[A-Z]{2}$",
      },
      standardReference: "GS1 Target Market (AI 424)",
    },
    {
      fieldKey: "gpcCategoryCode",
      label: "GPC Category Code",
      type: "string",
      required: "optional",
      description:
        "8-digit GS1 Global Product Classification code categorizing the trade item.",
      validationRules: {
        pattern: "^\\d{8}$",
      },
      standardReference: "GS1 GPC Category Code",
    },
  ],
  codeSystems: [
    {
      id: "gs1-packaging-level",
      name: "GS1 Packaging Level",
      values: [
        { code: "EA", display: "Each" },
        { code: "IP", display: "Inner Pack" },
        { code: "CS", display: "Case" },
        { code: "PL", display: "Pallet" },
      ],
    },
    {
      id: "gs1-uom",
      name: "GS1 Unit of Measure",
      values: [
        { code: "KGM", display: "kg" },
        { code: "GRM", display: "g" },
        { code: "LBR", display: "lb" },
        { code: "ONZ", display: "oz" },
        { code: "LTR", display: "L" },
        { code: "MLT", display: "mL" },
        { code: "MTR", display: "m" },
        { code: "CMT", display: "cm" },
        { code: "EA", display: "ea" },
        { code: "SHT", display: "sheet" },
        { code: "RM", display: "ream" },
      ],
    },
  ],
  exportFormats: ["gs1-xml", "json-schema"],
};
