import type { Constraint, Field, PortfolioSchema } from "../types";

export interface ConstraintError {
  fieldId: string;
  fieldName: string;
  message: string;
}

/** Evaluate all constraints for a schema against form data. */
export function evaluateConstraints(
  schema: PortfolioSchema,
  data: Record<string, unknown>,
): ConstraintError[] {
  const errors: ConstraintError[] = [];

  for (const field of schema.fields) {
    const fieldErrors = evaluateFieldConstraints(field, data);
    errors.push(...fieldErrors);

    // Handle nested group fields
    if (field.type.kind === "group") {
      for (const nested of field.type.fields) {
        const nestedErrors = evaluateFieldConstraints(nested, data);
        errors.push(...nestedErrors);
      }
    }
  }

  return errors;
}

function evaluateFieldConstraints(
  field: Field,
  data: Record<string, unknown>,
): ConstraintError[] {
  const errors: ConstraintError[] = [];
  const value = data[field.name];

  for (const constraint of field.constraints) {
    const error = evaluateSingleConstraint(field, constraint, value, data);
    if (error) errors.push(error);
  }

  return errors;
}

function evaluateSingleConstraint(
  field: Field,
  constraint: Constraint,
  value: unknown,
  data: Record<string, unknown>,
): ConstraintError | null {
  switch (constraint.type) {
    case "regex": {
      if (typeof value !== "string") return null;
      const regex = new RegExp(constraint.rule);
      if (!regex.test(value)) {
        return {
          fieldId: field.id,
          fieldName: field.name,
          message: constraint.message,
        };
      }
      return null;
    }

    case "dependency": {
      // Rule format: "fieldName:expectedValue" — this field is only valid
      // when the dependency field has the expected value
      const [depField, expectedValue] = constraint.rule.split(":");
      if (!depField) return null;
      const depValue = data[depField];
      if (String(depValue) !== expectedValue && value != null && value !== "") {
        return {
          fieldId: field.id,
          fieldName: field.name,
          message: constraint.message,
        };
      }
      return null;
    }

    case "computed": {
      // Rule is a simple expression that can reference other fields
      // For safety, we only support basic comparisons
      try {
        const result = evaluateExpression(constraint.rule, data);
        if (!result) {
          return {
            fieldId: field.id,
            fieldName: field.name,
            message: constraint.message,
          };
        }
      } catch {
        // Skip invalid expressions
      }
      return null;
    }

    case "custom":
      // Custom constraints are evaluated server-side
      return null;

    default:
      return null;
  }
}

/** Very basic expression evaluator for computed constraints. */
function evaluateExpression(
  rule: string,
  data: Record<string, unknown>,
): boolean {
  // Support: "fieldA > fieldB", "fieldA == value"
  const match = rule.match(
    /^(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/,
  );
  if (!match) return true;

  const [, leftField, op, rightRaw] = match;
  if (!leftField || !op || !rightRaw) return true;

  const leftVal = data[leftField];
  const rightVal = data[rightRaw.trim()] ?? rightRaw.trim();

  const left = Number(leftVal);
  const right = Number(rightVal);

  if (!isNaN(left) && !isNaN(right)) {
    switch (op) {
      case "==": return left === right;
      case "!=": return left !== right;
      case ">": return left > right;
      case "<": return left < right;
      case ">=": return left >= right;
      case "<=": return left <= right;
    }
  }

  // String comparison fallback
  switch (op) {
    case "==": return String(leftVal) === String(rightVal);
    case "!=": return String(leftVal) !== String(rightVal);
    default: return true;
  }
}
