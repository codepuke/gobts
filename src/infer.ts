// Type-level only — no runtime output.
import type {
  GobFieldType,
  PrimitiveField,
  SliceField,
  MapField,
  ArrayField,
  MarshalerField,
  SemanticField,
  FieldMap,
  Schema,
} from './types.ts';
import type { Complex, GobEncoded } from './types.ts';

// Maps bootstrap typeId literal to the corresponding TS type.
type InferPrimitive<T extends number> =
  T extends 1 ? boolean :
  T extends 2 | 3 ? bigint :
  T extends 4 ? number :
  T extends 5 ? Uint8Array :
  T extends 6 ? string :
  T extends 7 ? Complex :
  T extends 8 ? unknown :
  unknown;

/**
 * Derive the TypeScript type for a single GobFieldType descriptor.
 *
 * Works at compile time only — no runtime cost.
 */
export type InferField<F extends GobFieldType> =
  F extends PrimitiveField ? InferPrimitive<F['typeId']> :
  F extends Schema<infer FM extends FieldMap> ? { [K in keyof FM]: InferField<FM[K]> } :
  F extends { kind: 'struct'; schema: infer S extends Schema } ? InferSchema<S> :
  F extends SliceField ? Array<InferField<F['elem']>> :
  F extends MapField ? Map<InferField<F['key']>, InferField<F['elem']>> :
  F extends ArrayField ? Array<InferField<F['elem']>> :
  F extends MarshalerField ? GobEncoded :
  F extends SemanticField<infer T> ? T :
  unknown;

/**
 * Derive the TypeScript plain-object type for a Schema.
 *
 * Example:
 * ```ts
 * const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
 * type Point = InferSchema<typeof PointSchema>;
 * // { X: bigint; Y: bigint }
 * ```
 */
export type InferSchema<S extends Schema<FieldMap>> =
  S extends Schema<infer FM extends FieldMap>
    ? { [K in keyof FM]: InferField<FM[K]> }
    : never;
