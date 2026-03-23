import { describe, it, expect } from 'vitest';
import {
  addField,
  removeField,
  updateField,
  reorderFields,
  diffSchemas,
  isDiffEmpty,
  mergeSchemas,
  applyDiff,
  schemaToZod,
  validateDataAgainstSchema,
  toSlug,
  findField,
  getAllFieldIds,
} from '@/lib/engine/schema-ops';
import type { Field, PortfolioSchema, SchemaDiff } from '@/lib/types';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const baseSchema: PortfolioSchema = {
  fields: [],
  groups: [],
  version: 1,
};

const textField: Field = {
  id: 'field1',
  name: 'firstName',
  label: 'First Name',
  type: { kind: 'text', maxLength: 100 },
  required: true,
  constraints: [],
  origin: 'creator',
  tags: [],
};

const numberField: Field = {
  id: 'field2',
  name: 'age',
  label: 'Age',
  type: { kind: 'number', min: 0, max: 120 },
  required: false,
  constraints: [],
  origin: 'creator',
  tags: [],
};

const selectField: Field = {
  id: 'field3',
  name: 'status',
  label: 'Status',
  type: {
    kind: 'select',
    options: [
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
    ],
    multiple: false,
  },
  required: true,
  constraints: [],
  origin: 'creator',
  tags: [],
};

const groupField: Field = {
  id: 'field4',
  name: 'address',
  label: 'Address',
  type: {
    kind: 'group',
    fields: [
      {
        id: 'field4a',
        name: 'street',
        label: 'Street',
        type: { kind: 'text' },
        required: true,
        constraints: [],
        origin: 'creator',
        tags: [],
      },
      {
        id: 'field4b',
        name: 'city',
        label: 'City',
        type: { kind: 'text' },
        required: true,
        constraints: [],
        origin: 'creator',
        tags: [],
      },
    ],
  },
  required: false,
  constraints: [],
  origin: 'creator',
  tags: [],
};

// ---------------------------------------------------------------------------
// Field CRUD Tests
// ---------------------------------------------------------------------------

describe('addField', () => {
  it('should add field to end when no index specified', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const result = addField(schema, numberField);
    
    expect(result.fields).toHaveLength(2);
    expect(result.fields[1]).toEqual(numberField);
    expect(result.version).toBe(2);
  });

  it('should add field at specified index', () => {
    const schema = { ...baseSchema, fields: [textField, selectField] };
    const result = addField(schema, numberField, 1);
    
    expect(result.fields).toHaveLength(3);
    expect(result.fields[1]).toEqual(numberField);
    expect(result.fields[0]).toEqual(textField);
    expect(result.fields[2]).toEqual(selectField);
  });

  it('should increment version', () => {
    const schema = { ...baseSchema, version: 5 };
    const result = addField(schema, textField);
    expect(result.version).toBe(6);
  });
});

describe('removeField', () => {
  it('should remove field by ID', () => {
    const schema = { ...baseSchema, fields: [textField, numberField, selectField] };
    const result = removeField(schema, 'field2');
    
    expect(result.fields).toHaveLength(2);
    expect(result.fields.find(f => f.id === 'field2')).toBeUndefined();
  });

  it('should remove field from groups', () => {
    const schema: PortfolioSchema = {
      ...baseSchema,
      fields: [textField, numberField],
      groups: [
        { id: 'group1', label: 'Group 1', fieldIds: ['field1', 'field2'] },
      ],
    };
    
    const result = removeField(schema, 'field1');
    expect(result.groups[0].fieldIds).toEqual(['field2']);
  });

  it('should increment version', () => {
    const schema = { ...baseSchema, fields: [textField], version: 3 };
    const result = removeField(schema, 'field1');
    expect(result.version).toBe(4);
  });
});

describe('updateField', () => {
  it('should update field properties', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const result = updateField(schema, 'field1', { label: 'Full Name', required: false });
    
    expect(result.fields[0].label).toBe('Full Name');
    expect(result.fields[0].required).toBe(false);
    expect(result.fields[0].name).toBe('firstName'); // unchanged
  });

  it('should increment version', () => {
    const schema = { ...baseSchema, fields: [textField], version: 2 };
    const result = updateField(schema, 'field1', { label: 'New Label' });
    expect(result.version).toBe(3);
  });

  it('should not modify other fields', () => {
    const schema = { ...baseSchema, fields: [textField, numberField] };
    const result = updateField(schema, 'field1', { label: 'Updated' });
    expect(result.fields[1]).toEqual(numberField);
  });
});

describe('reorderFields', () => {
  it('should reorder fields according to orderedIds', () => {
    const schema = { ...baseSchema, fields: [textField, numberField, selectField] };
    const result = reorderFields(schema, ['field3', 'field1', 'field2']);
    
    expect(result.fields[0].id).toBe('field3');
    expect(result.fields[1].id).toBe('field1');
    expect(result.fields[2].id).toBe('field2');
  });

  it('should append fields not in orderedIds', () => {
    const schema = { ...baseSchema, fields: [textField, numberField, selectField] };
    const result = reorderFields(schema, ['field3', 'field1']);
    
    expect(result.fields[0].id).toBe('field3');
    expect(result.fields[1].id).toBe('field1');
    expect(result.fields[2].id).toBe('field2');
  });

  it('should increment version', () => {
    const schema = { ...baseSchema, fields: [textField], version: 10 };
    const result = reorderFields(schema, ['field1']);
    expect(result.version).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Schema Diffing Tests
// ---------------------------------------------------------------------------

describe('diffSchemas', () => {
  it('should detect added fields', () => {
    const oldSchema = { ...baseSchema, fields: [textField] };
    const newSchema = { ...baseSchema, fields: [textField, numberField] };
    const diff = diffSchemas(oldSchema, newSchema);
    
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe('field2');
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it('should detect removed fields', () => {
    const oldSchema = { ...baseSchema, fields: [textField, numberField] };
    const newSchema = { ...baseSchema, fields: [textField] };
    const diff = diffSchemas(oldSchema, newSchema);
    
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toBe('field2');
    expect(diff.added).toHaveLength(0);
  });

  it('should detect modified fields', () => {
    const oldSchema = { ...baseSchema, fields: [textField] };
    const modifiedField = { ...textField, label: 'Modified Label' };
    const newSchema = { ...baseSchema, fields: [modifiedField] };
    const diff = diffSchemas(oldSchema, newSchema);
    
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].fieldId).toBe('field1');
    expect(diff.modified[0].before).toEqual(textField);
    expect(diff.modified[0].after).toEqual(modifiedField);
  });

  it('should handle complex changes', () => {
    const oldSchema = { ...baseSchema, fields: [textField, numberField] };
    const modifiedText = { ...textField, label: 'Changed' };
    const newSchema = { ...baseSchema, fields: [modifiedText, selectField] };
    const diff = diffSchemas(oldSchema, newSchema);
    
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.modified).toHaveLength(1);
  });
});

describe('isDiffEmpty', () => {
  it('should return true for empty diff', () => {
    const diff: SchemaDiff = { added: [], removed: [], modified: [] };
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it('should return false when fields added', () => {
    const diff: SchemaDiff = { added: [textField], removed: [], modified: [] };
    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('should return false when fields removed', () => {
    const diff: SchemaDiff = { added: [], removed: ['field1'], modified: [] };
    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('should return false when fields modified', () => {
    const diff: SchemaDiff = {
      added: [],
      removed: [],
      modified: [{ fieldId: 'field1', before: textField, after: textField }],
    };
    expect(isDiffEmpty(diff)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema Merging Tests
// ---------------------------------------------------------------------------

describe('mergeSchemas', () => {
  it('should merge fields with source overwriting target', () => {
    const target = { ...baseSchema, fields: [textField] };
    const modifiedText = { ...textField, label: 'Modified' };
    const source = { ...baseSchema, fields: [modifiedText, numberField] };
    
    const result = mergeSchemas(target, source);
    
    expect(result.fields).toHaveLength(2);
    expect(result.fields.find(f => f.id === 'field1')?.label).toBe('Modified');
    expect(result.fields.find(f => f.id === 'field2')).toBeDefined();
  });

  it('should merge groups', () => {
    const target: PortfolioSchema = {
      ...baseSchema,
      groups: [{ id: 'g1', label: 'Group 1', fieldIds: ['field1'] }],
    };
    const source: PortfolioSchema = {
      ...baseSchema,
      groups: [{ id: 'g2', label: 'Group 2', fieldIds: ['field2'] }],
    };
    
    const result = mergeSchemas(target, source);
    expect(result.groups).toHaveLength(2);
  });

  it('should increment version to max + 1', () => {
    const target = { ...baseSchema, version: 5 };
    const source = { ...baseSchema, version: 8 };
    const result = mergeSchemas(target, source);
    expect(result.version).toBe(9);
  });
});

describe('applyDiff', () => {
  it('should apply added fields', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const diff: SchemaDiff = { added: [numberField], removed: [], modified: [] };
    const result = applyDiff(schema, diff);
    
    expect(result.fields).toHaveLength(2);
    expect(result.fields.find(f => f.id === 'field2')).toBeDefined();
  });

  it('should apply removed fields', () => {
    const schema = { ...baseSchema, fields: [textField, numberField] };
    const diff: SchemaDiff = { added: [], removed: ['field1'], modified: [] };
    const result = applyDiff(schema, diff);
    
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].id).toBe('field2');
  });

  it('should apply modified fields', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const modifiedField = { ...textField, label: 'New Label' };
    const diff: SchemaDiff = {
      added: [],
      removed: [],
      modified: [{ fieldId: 'field1', before: textField, after: modifiedField }],
    };
    const result = applyDiff(schema, diff);
    
    expect(result.fields[0].label).toBe('New Label');
  });

  it('should increment version', () => {
    const schema = { ...baseSchema, fields: [], version: 7 };
    const diff: SchemaDiff = { added: [], removed: [], modified: [] };
    const result = applyDiff(schema, diff);
    expect(result.version).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Zod Conversion Tests
// ---------------------------------------------------------------------------

describe('schemaToZod', () => {
  it('should convert text field', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const zodSchema = schemaToZod(schema);
    
    expect(zodSchema.safeParse({ firstName: 'John' }).success).toBe(true);
    expect(zodSchema.safeParse({}).success).toBe(false);
  });

  it('should convert number field', () => {
    const schema = { ...baseSchema, fields: [numberField] };
    const zodSchema = schemaToZod(schema);
    
    expect(zodSchema.safeParse({ age: 25 }).success).toBe(true);
    expect(zodSchema.safeParse({ age: 150 }).success).toBe(false); // max is 120
    expect(zodSchema.safeParse({}).success).toBe(true); // not required
  });

  it('should convert select field', () => {
    const schema = { ...baseSchema, fields: [selectField] };
    const zodSchema = schemaToZod(schema);
    
    expect(zodSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(zodSchema.safeParse({ status: 'invalid' }).success).toBe(false);
  });

  it('should handle optional fields', () => {
    const optionalField: Field = { ...textField, required: false };
    const schema = { ...baseSchema, fields: [optionalField] };
    const zodSchema = schemaToZod(schema);
    
    expect(zodSchema.safeParse({}).success).toBe(true);
    expect(zodSchema.safeParse({ firstName: 'John' }).success).toBe(true);
  });
});

describe('validateDataAgainstSchema', () => {
  it('should validate valid data', () => {
    const schema = { ...baseSchema, fields: [textField, numberField] };
    const data = { firstName: 'John', age: 30 };
    const result = validateDataAgainstSchema(data, schema);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('should return errors for invalid data', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const data = {};
    const result = validateDataAgainstSchema(data, schema);
    
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it('should validate number constraints', () => {
    const schema = { ...baseSchema, fields: [numberField] };
    const data = { age: 150 };
    const result = validateDataAgainstSchema(data, schema);
    
    expect(result.valid).toBe(false);
    expect(result.errors.age).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Utility Tests
// ---------------------------------------------------------------------------

describe('toSlug', () => {
  it('should convert text to URL-safe slug', () => {
    expect(toSlug('Hello World')).toBe('hello-world');
    expect(toSlug('Test   Multiple   Spaces')).toBe('test-multiple-spaces');
    expect(toSlug('Special!@#Characters')).toBe('specialcharacters');
  });

  it('should handle edge cases', () => {
    expect(toSlug('---start-end---')).toBe('start-end');
    expect(toSlug('UPPERCASE')).toBe('uppercase');
    expect(toSlug('')).toBe('');
  });
});

describe('findField', () => {
  it('should find top-level field', () => {
    const schema = { ...baseSchema, fields: [textField, numberField] };
    const found = findField(schema, 'field1');
    expect(found).toEqual(textField);
  });

  it('should find nested field in group', () => {
    const schema = { ...baseSchema, fields: [groupField] };
    const found = findField(schema, 'field4a');
    expect(found?.name).toBe('street');
  });

  it('should return undefined for non-existent field', () => {
    const schema = { ...baseSchema, fields: [textField] };
    const found = findField(schema, 'nonexistent');
    expect(found).toBeUndefined();
  });
});

describe('getAllFieldIds', () => {
  it('should return all field IDs including nested', () => {
    const schema = { ...baseSchema, fields: [textField, numberField, groupField] };
    const ids = getAllFieldIds(schema);
    
    expect(ids).toContain('field1');
    expect(ids).toContain('field2');
    expect(ids).toContain('field4');
    expect(ids).toContain('field4a');
    expect(ids).toContain('field4b');
    expect(ids).toHaveLength(5);
  });

  it('should return empty array for empty schema', () => {
    const schema = { ...baseSchema, fields: [] };
    const ids = getAllFieldIds(schema);
    expect(ids).toEqual([]);
  });
});
