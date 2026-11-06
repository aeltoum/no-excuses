import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPushSender,
  fromBase64Url,
  toBase64Url,
} from "../packages/delivery/src/web-push.js";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function receiver() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint: "https://push.example.test/send/abc",
      keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(auth) },
    },
  };
}

function vapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    subject: "mailto:ops@example.test",
    publicKey: b64(ecdh.getPublicKey()),
    privateKey: b64(ecdh.getPrivateKey()),
  };
}

// RFC 8291 receiver side, written against node:crypto rather than WebCrypto.
function decrypt(
  body: Buffer,
  ecdh: ReturnType<typeof createECDH>,
  auth: Buffer,
) {
  const salt = body.subarray(0, 16);
  expect(body.readUInt32BE(16)).toBe(4096);
  const idLength = body[20] ?? 0;
  const senderKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ecdh.computeSecret(senderKey);
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      auth,
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        ecdh.getPublicKey(),
        senderKey,
      ]),
      32,
    ),
  );
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12),
  );
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe("Web Push sender", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(bytes)).toBe(b64(bytes));
  });

  it("encrypts per RFC 8291 and signs a VAPID token per RFC 8292", async () => {
    const vapid = vapidKeys();
    const { ecdh, auth, subscription } = receiver();
    const sent: { url: string; init: RequestInit }[] = [];
    const sender = createPushSender(vapid, async (url, init) => {
      sent.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 201 });
    });
    const payload = JSON.stringify({ title: "Crown", body: "You took it 👑" });

    expect(await sender(subscription, payload, 86400)).toBe(201);
    expect(await sender(subscription, payload, 60)).toBe(201);

    const [first, second] = sent;
    if (!first || !second) throw new Error("expected two sends");
    expect(first.url).toBe(subscription.endpoint);
    const headers = new Headers(first.init.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("ttl")).toBe("86400");
    expect(new Headers(second.init.headers).get("ttl")).toBe("60");
    expect(
      decrypt(Buffer.from(first.init.body as Uint8Array), ecdh, auth),
    ).toBe(payload);

    const match = /^vapid t=([^,]+), k=(.+)$/.exec(
      headers.get("authorization") ?? "",
    );
    expect(match?.[2]).toBe(vapid.publicKey);
    const [header, claims, signature] = (match?.[1] ?? "").split(".");
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    ).toEqual({ typ: "JWT", alg: "ES256" });
    const body = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
    expect(body.aud).toBe("https://push.example.test");
    expect(body.sub).toBe(vapid.subject);
    expect(body.exp - Date.now() / 1000).toBeGreaterThan(11 * 3600);
    expect(body.exp - Date.now() / 1000).toBeLessThanOrEqual(12 * 3600);
    const point = fromBase64Url(vapid.publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64(point.slice(1, 33)),
        y: b64(point.slice(33)),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
    // The token is reused across sends to the same push service.
    expect(new Headers(second.init.headers).get("authorization")).toBe(
      headers.get("authorization"),
    );
  });

  it("reports a gone subscription by status", async () => {
    const sender = createPushSender(
      vapidKeys(),
      async () => new Response("gone", { status: 410 }),
    );
    expect(await sender(receiver().subscription, "{}", 60)).toBe(410);
  });
});
