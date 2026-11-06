// Web Push with WebCrypto and fetch only, so delivery runs the same on Node and
// Cloudflare Workers: RFC 8291 message encryption (aes128gcm) and RFC 8292 VAPID.

export type PushSubscription = Readonly<{
  endpoint: string;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;
export type Vapid = Readonly<{
  subject: string;
  publicKey: string;
  privateKey: string;
}>;

type Bytes = Uint8Array<ArrayBuffer>;
const text = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export const fromBase64Url = (value: string) =>
  Uint8Array.from(
    atob(
      value.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (value.length % 4)) % 4),
    ),
    (char) => char.charCodeAt(0),
  );
export const toBase64Url = (bytes: Bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, bytes: number) {
  const key = await subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      bytes * 8,
    ),
  );
}

// One record, no padding: salt | record size | key id length | sender key | ciphertext.
export async function encryptPayload(
  subscription: PushSubscription,
  payload: string,
) {
  const receiverKey = fromBase64Url(subscription.keys.p256dh);
  const authSecret = fromBase64Url(subscription.keys.auth);
  const sender = (await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const senderKey = new Uint8Array(
    await subtle.exportKey("raw", sender.publicKey),
  );
  const receiver = await subtle.importKey(
    "raw",
    receiverKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle.deriveBits(
      { name: "ECDH", public: receiver },
      sender.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(text.encode("WebPush: info\0"), receiverKey, senderKey),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt,
    ikm,
    text.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    text.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      // 0x02 marks the last (only) record.
      concat(text.encode(payload), new Uint8Array([2])),
    ),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(
    salt,
    recordSize,
    new Uint8Array([senderKey.length]),
    senderKey,
    ciphertext,
  );
}

export function createPushSender(
  vapid: Vapid,
  send: typeof fetch = (input, init) => fetch(input, init),
) {
  const publicKey = fromBase64Url(vapid.publicKey);
  const signingKey = subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: toBase64Url(publicKey.slice(1, 33)),
      y: toBase64Url(publicKey.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // A token per push service lasts 12 hours; reuse it for the first 11.
  const tokens = new Map<string, { token: string; renewAt: number }>();
  async function authorization(audience: string) {
    const now = Math.floor(Date.now() / 1000);
    const cached = tokens.get(audience);
    if (cached && cached.renewAt > now) return cached.token;
    const encode = (value: unknown) =>
      toBase64Url(text.encode(JSON.stringify(value)));
    const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
      aud: audience,
      exp: now + 12 * 3600,
      sub: vapid.subject,
    })}`;
    const signature = new Uint8Array(
      await subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        await signingKey,
        text.encode(unsigned),
      ),
    );
    const token = `${unsigned}.${toBase64Url(signature)}`;
    tokens.set(audience, { token, renewAt: now + 11 * 3600 });
    return token;
  }

  // Resolves with the push service's HTTP status; 404 and 410 mean the subscription is gone.
  return async (
    subscription: PushSubscription,
    payload: string,
    ttlSeconds: number,
  ): Promise<number> => {
    const audience = new URL(subscription.endpoint).origin;
    const response = await send(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: `vapid t=${await authorization(audience)}, k=${vapid.publicKey}`,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttlSeconds),
      },
      body: await encryptPayload(subscription, payload),
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    return response.status;
  };
}
