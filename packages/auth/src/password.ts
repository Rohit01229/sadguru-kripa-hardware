import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "node:crypto";

// argon2id tuning (07 §1): ~64 MiB memory, 3 iterations. Re-tune on prod hardware.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "encoded",
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify({ password, hash });
}
