import { minVersion, satisfies, validRange } from "semver";

/** Legacy signed ranges retain their bytes; host compatibility uses their minimum. */
export function isCapabilityHostCompatible(
  hostVersion: string,
  hostRange: string,
): boolean {
  const minimum = validRange(hostRange) ? minVersion(hostRange) : null;
  return minimum !== null && satisfies(hostVersion, `>=${minimum.version}`);
}
