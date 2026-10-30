import { randomInt } from "node:crypto";

// No I, O, 0 or 1: safe to read aloud, paste, and retype.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_SIZE = 4;
const GROUPS = 4;

/**
 * 16 characters (~79 bits) over an unambiguous alphabet, formatted as
 * `XXXX-XXXX-XXXX-XXXX`. Uses the CSPRNG, never Math.random.
 */
export function generatePassword(): string {
  const groups: string[] = [];

  for (let group = 0; group < GROUPS; group += 1) {
    let chunk = "";
    for (let index = 0; index < GROUP_SIZE; index += 1) {
      chunk += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(chunk);
  }

  return groups.join("-");
}
