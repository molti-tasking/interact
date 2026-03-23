import { describe, it, expect } from "vitest";
import { evaluateConstraints } from "@/lib/form-renderer/validation";
import type { Field, PortfolioSchema, Constraint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const createField = (overrides: Partial<Field> = {}): Field => ({
  id: "field-1",
  name: "testField",
  label: "Test Field",
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "creator",
  tags: [],
  ...overrides,
});

const createSchema = (fields: Field[] = []): PortfolioSchema => ({
  fields,
  groups: [],
  version: 1,
});

// ---------------------------------------------------------------------------
// Regex Constraint Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - regex", () => {
  it("validates valid email format", () => {
    const constraint: Constraint = {
      type: "regex",
      rule: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      message: "Invalid email format",
    };
    const field = createField({
      name: "email",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, { email: "test@example.com" });
    
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid email format", () => {
    const constraint: Constraint = {
      type: "regex",
      rule: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      message: "Invalid email format",
    };
    const field = createField({
      name: "email",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, { email: "invalid-email" });
    
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("Invalid email format");
    expect(errors[0]?.fieldName).toBe("email");
  });

  it("validates phone number format", () => {
    const constraint: Constraint = {
      type: "regex",
      rule: "^\\d{3}-\\d{3}-\\d{4}$",
      message: "Phone must be in format: 123-456-7890",
    };
    const field = createField({
      name: "phone",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { phone: "555-123-4567" });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { phone: "5551234567" });
    expect(invalidErrors).toHaveLength(1);
    expect(invalidErrors[0]?.message).toBe("Phone must be in format: 123-456-7890");
  });

  it("skips regex validation for non-string values", () => {
    const constraint: Constraint = {
      type: "regex",
      rule: "^\\d+$",
      message: "Must be numeric",
    };
    const field = createField({
      name: "value",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, { value: 123 });
    
    // Regex only applies to strings, so numeric value is skipped (no error)
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dependency Constraint Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - dependency", () => {
  it("allows field when dependency is met", () => {
    const constraint: Constraint = {
      type: "dependency",
      rule: "hasInsurance:yes",
      message: "Insurance provider is only required if you have insurance",
    };
    const field = createField({
      name: "insuranceProvider",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, {
      hasInsurance: "yes",
      insuranceProvider: "Blue Cross",
    });
    
    expect(errors).toHaveLength(0);
  });

  it("rejects field when dependency is not met", () => {
    const constraint: Constraint = {
      type: "dependency",
      rule: "hasInsurance:yes",
      message: "Insurance provider is only required if you have insurance",
    };
    const field = createField({
      name: "insuranceProvider",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, {
      hasInsurance: "no",
      insuranceProvider: "Blue Cross",
    });
    
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("Insurance provider is only required if you have insurance");
  });

  it("allows empty field when dependency is not met", () => {
    const constraint: Constraint = {
      type: "dependency",
      rule: "hasInsurance:yes",
      message: "Insurance provider is only required if you have insurance",
    };
    const field = createField({
      name: "insuranceProvider",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, {
      hasInsurance: "no",
      insuranceProvider: "",
    });
    
    expect(errors).toHaveLength(0);
  });

  it("allows null field when dependency is not met", () => {
    const constraint: Constraint = {
      type: "dependency",
      rule: "hasInsurance:yes",
      message: "Insurance provider is only required if you have insurance",
    };
    const field = createField({
      name: "insuranceProvider",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, {
      hasInsurance: "no",
      insuranceProvider: null,
    });
    
    expect(errors).toHaveLength(0);
  });

  it("handles missing dependency field", () => {
    const constraint: Constraint = {
      type: "dependency",
      rule: "hasInsurance:yes",
      message: "Dependency error",
    };
    const field = createField({
      name: "insuranceProvider",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    // Dependency field is missing — should allow the value
    const errors = evaluateConstraints(schema, {
      insuranceProvider: "Blue Cross",
    });
    
    expect(errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Computed Constraint Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - computed", () => {
  it("validates numeric equality", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "quantity == 5",
      message: "Quantity must equal 5",
    };
    const field = createField({
      name: "result",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { quantity: 5 });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { quantity: 3 });
    expect(invalidErrors).toHaveLength(1);
    expect(invalidErrors[0]?.message).toBe("Quantity must equal 5");
  });

  it("validates greater than", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "age > 18",
      message: "Must be over 18",
    };
    const field = createField({
      name: "consent",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { age: 25 });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { age: 16 });
    expect(invalidErrors).toHaveLength(1);
    expect(invalidErrors[0]?.message).toBe("Must be over 18");
  });

  it("validates less than", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "score < 100",
      message: "Score must be under 100",
    };
    const field = createField({
      name: "result",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { score: 95 });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { score: 105 });
    expect(invalidErrors).toHaveLength(1);
  });

  it("validates greater than or equal", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "rating >= 3",
      message: "Rating must be at least 3",
    };
    const field = createField({
      name: "approval",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    expect(evaluateConstraints(schema, { rating: 3 })).toHaveLength(0);
    expect(evaluateConstraints(schema, { rating: 4 })).toHaveLength(0);
    expect(evaluateConstraints(schema, { rating: 2 })).toHaveLength(1);
  });

  it("validates less than or equal", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "discount <= 50",
      message: "Discount cannot exceed 50",
    };
    const field = createField({
      name: "finalPrice",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    expect(evaluateConstraints(schema, { discount: 50 })).toHaveLength(0);
    expect(evaluateConstraints(schema, { discount: 30 })).toHaveLength(0);
    expect(evaluateConstraints(schema, { discount: 60 })).toHaveLength(1);
  });

  it("validates not equal", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "status != pending",
      message: "Status cannot be pending",
    };
    const field = createField({
      name: "result",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { status: "approved" });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { status: "pending" });
    expect(invalidErrors).toHaveLength(1);
  });

  it("compares two fields", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "endDate > startDate",
      message: "End date must be after start date",
    };
    const field = createField({
      name: "booking",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, {
      startDate: 10,
      endDate: 20,
    });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, {
      startDate: 20,
      endDate: 10,
    });
    expect(invalidErrors).toHaveLength(1);
  });

  it("falls back to string comparison for non-numeric values", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "name == John",
      message: "Name must be John",
    };
    const field = createField({
      name: "result",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    const validErrors = evaluateConstraints(schema, { name: "John" });
    expect(validErrors).toHaveLength(0);
    
    const invalidErrors = evaluateConstraints(schema, { name: "Jane" });
    expect(invalidErrors).toHaveLength(1);
  });

  it("skips invalid expression format", () => {
    const constraint: Constraint = {
      type: "computed",
      rule: "invalid expression format",
      message: "Invalid",
    };
    const field = createField({
      name: "result",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    // Invalid expression should be skipped (no error)
    const errors = evaluateConstraints(schema, { result: "anything" });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Custom Constraint Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - custom", () => {
  it("skips custom constraints (evaluated server-side)", () => {
    const constraint: Constraint = {
      type: "custom",
      rule: "someServerSideRule",
      message: "Custom validation failed",
    };
    const field = createField({
      name: "field",
      constraints: [constraint],
    });
    const schema = createSchema([field]);
    
    // Custom constraints are not evaluated client-side
    const errors = evaluateConstraints(schema, { field: "anything" });
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple Constraints Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - multiple constraints", () => {
  it("validates all constraints for a field", () => {
    const field = createField({
      name: "email",
      constraints: [
        {
          type: "regex",
          rule: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
          message: "Invalid email format",
        },
        {
          type: "regex",
          rule: ".*@company\\.com$",
          message: "Must be a company email",
        },
      ],
    });
    const schema = createSchema([field]);
    
    // Valid company email
    expect(evaluateConstraints(schema, { email: "user@company.com" })).toHaveLength(0);
    
    // Valid format but not company email
    const errors1 = evaluateConstraints(schema, { email: "user@other.com" });
    expect(errors1).toHaveLength(1);
    expect(errors1[0]?.message).toBe("Must be a company email");
    
    // Invalid format
    const errors2 = evaluateConstraints(schema, { email: "invalid" });
    expect(errors2).toHaveLength(2); // Both constraints fail
  });
});

// ---------------------------------------------------------------------------
// Nested Group Fields Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - nested group fields", () => {
  it("validates constraints in nested group fields", () => {
    const nestedField = createField({
      id: "nested-1",
      name: "email",
      constraints: [
        {
          type: "regex",
          rule: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
          message: "Invalid email",
        },
      ],
    });
    
    const groupField = createField({
      id: "group-1",
      name: "contactInfo",
      type: { kind: "group", fields: [nestedField] },
    });
    
    const schema = createSchema([groupField]);
    
    const errors = evaluateConstraints(schema, { email: "invalid-email" });
    
    expect(errors).toHaveLength(1);
    expect(errors[0]?.fieldName).toBe("email");
    expect(errors[0]?.message).toBe("Invalid email");
  });
});

// ---------------------------------------------------------------------------
// Empty Schema / No Constraints Tests
// ---------------------------------------------------------------------------

describe("evaluateConstraints - edge cases", () => {
  it("returns no errors for empty schema", () => {
    const schema = createSchema([]);
    
    const errors = evaluateConstraints(schema, { anything: "value" });
    
    expect(errors).toHaveLength(0);
  });

  it("returns no errors for fields with no constraints", () => {
    const field = createField({
      name: "freeText",
      constraints: [],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, { freeText: "any value" });
    
    expect(errors).toHaveLength(0);
  });

  it("returns no errors when data is empty", () => {
    const field = createField({
      name: "email",
      constraints: [
        {
          type: "regex",
          rule: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
          message: "Invalid email",
        },
      ],
    });
    const schema = createSchema([field]);
    
    const errors = evaluateConstraints(schema, {});
    
    // Regex validation skips non-string values (including undefined)
    expect(errors).toHaveLength(0);
  });
});
