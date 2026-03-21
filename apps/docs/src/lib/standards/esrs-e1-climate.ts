import type { DomainStandard } from "../domain-standards";

export const esrsE1Climate: DomainStandard = {
  id: "esrs-e1-climate",
  name: "ESRS E1 Climate Change",
  domain: "sustainability",
  version: "ESRS Set 1 (2023)",
  description:
    "European Sustainability Reporting Standards E1 — Climate Change. Defines disclosure requirements for climate-related governance, strategy, targets, and metrics including GHG emissions.",
  url: "https://www.efrag.org/lab6",
  keywords: [
    "climate",
    "sustainability",
    "emissions",
    "carbon",
    "ghg",
    "greenhouse gas",
    "esrs",
    "esg",
    "environmental",
    "carbon footprint",
    "net zero",
    "scope 1",
    "scope 2",
    "scope 3",
    "energy consumption",
    "renewable energy",
    "climate risk",
    "transition plan",
    "decarbonization",
    "csrd",
    "eu taxonomy",
  ],
  fieldConstraints: [
    {
      fieldKey: "transitionPlan",
      label: "Climate Transition Plan",
      type: "select",
      required: "mandatory",
      description:
        "Whether the undertaking has adopted a transition plan for climate change mitigation. ESRS E1-1 requires disclosure.",
      validationRules: {
        options: [
          "Adopted",
          "Under development",
          "Not yet considered",
        ],
      },
      standardReference: "ESRS E1-1 (Transition plan for climate change mitigation)",
    },
    {
      fieldKey: "ghgReductionTargets",
      label: "GHG Emission Reduction Targets",
      type: "string",
      required: "mandatory",
      description:
        "Quantitative GHG emission reduction targets, including base year, target year, and scope coverage.",
      standardReference: "ESRS E1-4 (Targets related to climate change mitigation and adaptation)",
    },
    {
      fieldKey: "scope1Emissions",
      label: "Scope 1 GHG Emissions (tCO2e)",
      type: "number",
      required: "mandatory",
      description:
        "Direct GHG emissions from owned or controlled sources, in tonnes of CO2 equivalent.",
      validationRules: { min: 0 },
      standardReference: "ESRS E1-6 (Gross Scopes 1, 2, 3 and Total GHG emissions)",
    },
    {
      fieldKey: "scope2Emissions",
      label: "Scope 2 GHG Emissions (tCO2e)",
      type: "number",
      required: "mandatory",
      description:
        "Indirect GHG emissions from purchased energy (electricity, heat, steam, cooling), in tCO2e.",
      validationRules: { min: 0 },
      standardReference: "ESRS E1-6 (Gross Scopes 1, 2, 3 and Total GHG emissions)",
    },
    {
      fieldKey: "scope3Emissions",
      label: "Scope 3 GHG Emissions (tCO2e)",
      type: "number",
      required: "mandatory",
      description:
        "All other indirect GHG emissions in the value chain (upstream and downstream), in tCO2e.",
      validationRules: { min: 0 },
      standardReference: "ESRS E1-6 (Gross Scopes 1, 2, 3 and Total GHG emissions)",
    },
    {
      fieldKey: "totalEnergyConsumption",
      label: "Total Energy Consumption (MWh)",
      type: "number",
      required: "mandatory",
      description:
        "Total energy consumption from all sources, in megawatt-hours.",
      validationRules: { min: 0 },
      standardReference: "ESRS E1-5 (Energy consumption and mix)",
    },
    {
      fieldKey: "renewableEnergyShare",
      label: "Renewable Energy Share (%)",
      type: "number",
      required: "recommended",
      description:
        "Percentage of total energy consumption from renewable sources.",
      validationRules: { min: 0, max: 100 },
      standardReference: "ESRS E1-5 (Energy consumption and mix)",
    },
    {
      fieldKey: "climateRiskAssessment",
      label: "Physical Climate Risk Assessment",
      type: "select",
      required: "recommended",
      description:
        "Whether the undertaking has assessed physical climate risks (acute and chronic) for its operations.",
      validationRules: {
        options: [
          "Comprehensive assessment completed",
          "Partial assessment completed",
          "Assessment planned",
          "Not yet assessed",
        ],
      },
      standardReference: "ESRS E1-9 (Anticipated financial effects from material physical and transition risks)",
    },
    {
      fieldKey: "carbonPricingExposure",
      label: "Carbon Pricing Exposure",
      type: "select",
      required: "optional",
      description:
        "Whether the undertaking's operations are subject to carbon pricing mechanisms (ETS, carbon tax).",
      validationRules: {
        options: [
          "Subject to EU ETS",
          "Subject to other carbon pricing",
          "Subject to multiple mechanisms",
          "Not subject to carbon pricing",
        ],
      },
      standardReference: "ESRS E1-9 (Anticipated financial effects from material physical and transition risks)",
    },
    {
      fieldKey: "internalCarbonPrice",
      label: "Internal Carbon Price (EUR/tCO2e)",
      type: "number",
      required: "optional",
      description:
        "Internal carbon price used for investment decisions, if applicable.",
      validationRules: { min: 0 },
      standardReference: "ESRS E1-8 (Internal carbon pricing)",
    },
  ],
  codeSystems: [
    {
      id: "ghg-scopes",
      name: "GHG Protocol Scopes",
      values: [
        { code: "scope1", display: "Scope 1 — Direct emissions" },
        { code: "scope2", display: "Scope 2 — Indirect (energy)" },
        { code: "scope3", display: "Scope 3 — Other indirect (value chain)" },
      ],
    },
    {
      id: "energy-sources",
      name: "Energy Source Types",
      values: [
        { code: "fossil-gas", display: "Natural gas" },
        { code: "fossil-oil", display: "Oil / petroleum" },
        { code: "fossil-coal", display: "Coal" },
        { code: "nuclear", display: "Nuclear" },
        { code: "solar", display: "Solar" },
        { code: "wind", display: "Wind" },
        { code: "hydro", display: "Hydropower" },
        { code: "biomass", display: "Biomass" },
        { code: "geothermal", display: "Geothermal" },
        { code: "other-renewable", display: "Other renewable" },
      ],
    },
  ],
  exportFormats: ["json-schema"],
};
