import { Builder } from "flatbuffers";

export interface WindowsSandboxSpecification {
  writablePaths: string[];
  readOnlyPaths: string[];
  allowNetwork: boolean;
}

function createStringVector(builder: Builder, values: string[]): number {
  const offsets = values.map((value) => builder.createString(value));
  builder.startVector(4, offsets.length, 4);
  for (let index = offsets.length - 1; index >= 0; index -= 1) {
    builder.addOffset(offsets[index]!);
  }
  return builder.endVector();
}

/**
 * Encodes the experimental Windows SandboxSpec v0.1.0 FlatBuffer.
 *
 * The public API currently exposes the field contract but no generated header,
 * so this intentionally mirrors the documented field order and file identifier.
 */
export function encodeWindowsSandboxSpecification(
  input: WindowsSandboxSpecification,
): Buffer {
  const builder = new Builder(1024);
  const version = builder.createString("0.1.0");
  const capabilities = input.allowNetwork
    ? builder.createString("internetClient")
    : 0;
  const writablePaths = createStringVector(builder, input.writablePaths);
  const readOnlyPaths = createStringVector(builder, input.readOnlyPaths);

  builder.startObject(9);
  builder.addFieldOffset(0, version, 0);
  builder.addFieldInt8(1, 1, 0);
  builder.addFieldInt64(4, 0xffn, 0n);
  if (capabilities !== 0) {
    builder.addFieldOffset(5, capabilities, 0);
  }
  builder.addFieldOffset(6, writablePaths, 0);
  builder.addFieldOffset(7, readOnlyPaths, 0);
  const root = builder.endObject();
  builder.finish(root, "SBOX");

  return Buffer.from(builder.asUint8Array());
}
