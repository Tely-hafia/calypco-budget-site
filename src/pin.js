const encoder = new TextEncoder();
const ITERATIONS = 250_000;
const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

async function derive(pin, salt, userId, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations,
    salt: encoder.encode(`${salt}:${userId}`)
  }, material, 256);
  return bytesToHex(new Uint8Array(derived));
}

export function validPin(pin) {
  return /^\d{6}$/.test(pin) && !['031994', '123456', '654321', '000000'].includes(pin)
    && !/^(\d)\1{5}$/.test(pin);
}

export async function makePinRecord(pin, userId) {
  if (!validPin(pin)) throw new Error('Choisis un autre code de 6 chiffres, jamais partagé dans une conversation.');
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return { version: 1, salt, iterations: ITERATIONS, hash: await derive(pin, salt, userId, ITERATIONS) };
}

export async function verifyPin(pin, userId, record) {
  if (!/^\d{6}$/.test(pin) || record?.version !== 1 || !/^[0-9a-f]{32}$/.test(record.salt)
    || !Number.isInteger(record.iterations) || record.iterations < 100_000 || !/^[0-9a-f]{64}$/.test(record.hash)) return false;
  const hash = await derive(pin, record.salt, userId, record.iterations);
  let mismatch = 0;
  for (let index = 0; index < hash.length; index++) mismatch |= hash.charCodeAt(index) ^ record.hash.charCodeAt(index);
  return mismatch === 0;
}
