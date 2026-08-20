// Doc examples for gobts — schemas and type descriptors.
// The marked regions below are extracted by the codepuke sync (see CLAUDE.md
// → "Documentation snippets") and published on the docs site. Keep them free
// of test scaffolding: imports and assertions stay outside the markers so the
// extracted snippet is clean top-level code.
import { test, expect } from 'bun:test';
import {
  Schema,
  SemanticType,
  SliceOf,
  GOB_INT,
  GOB_STRING,
  encode,
  decode,
  type GobObject,
  type InferSchema,
} from '../src/index.ts';

test('define-schema: schemas mirror Go struct declarations', () => {
  // snippet:start define-schema
  // Go: type Point struct { X, Y int }
  const PointSchema = new Schema('Point', {
    X: GOB_INT,
    Y: GOB_INT,
  });

  // Go: type Person struct {
  //         Name string
  //         Age  int
  //         Tags []string
  //     }
  const PersonSchema = new Schema('Person', {
    Name: GOB_STRING,
    Age: GOB_INT,
    Tags: SliceOf(GOB_STRING),
  });
  // snippet:end

  expect(PointSchema.name).toBe('Point');
  expect(PersonSchema.fields.map(([name]) => name)).toEqual(['Name', 'Age', 'Tags']);
});

test('schema-type-inference: derive the TypeScript type from a schema', () => {
  // snippet:start schema-type-inference
  const PersonSchema = new Schema('Person', {
    Name: GOB_STRING,
    Age: GOB_INT,
  });

  // InferSchema is type-level only — it emits no runtime code.
  //   { Name: string; Age: bigint }
  type Person = InferSchema<typeof PersonSchema>;

  const ada: Person = { Name: 'Ada', Age: 36n };
  const bytes = encode(ada, { schema: PersonSchema });
  // snippet:end

  expect(bytes.length).toBeGreaterThan(0);
});

test('semantic-type: map a named Go type onto a TypeScript type', () => {
  // snippet:start semantic-type
  // Go: type Status string
  type Status = 'active' | 'inactive';

  const GOB_STATUS = SemanticType<Status>({
    wire: GOB_STRING,
    encode: (value) => value,
    decode: (wire) => wire as Status,
    zero: 'inactive',
  });

  const UserSchema = new Schema('User', {
    Name: GOB_STRING,
    Status: GOB_STATUS,
  });

  const bytes = encode({ Name: 'Ada', Status: 'active' }, { schema: UserSchema });
  const user = decode<GobObject>(bytes);
  const status = user.get('Status') as Status; // "active"
  // snippet:end

  expect(status).toBe('active');
});
