/**
 * Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) for Cloudflare Workers.
 * Adapted from @block65/webcrypto-web-push (MIT) — no Node deps; Web Crypto only.
 */
function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (String(s).length % 4)) % 4);
  const b64 = (String(s) + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64url(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strBytes(s) {
  return new TextEncoder().encode(String(s));
}
function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "webpush assert");
}
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
function createKeyInfo(clientPublic, serverPublic) {
  return concatBytes([strBytes("WebPush: info\0"), clientPublic, serverPublic]);
}
function createInfo(type) {
  return strBytes("Content-Encoding: " + type + "\0");
}
function createHMAC(keyData) {
  const keyP = crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return {
    hash: async (input) => {
      const k = await keyP;
      return crypto.subtle.sign("HMAC", k, input);
    }
  };
}
async function hkdf(salt, ikm) {
  const prkhP = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: async (info, len) => {
      const prkh = await prkhP;
      const blocks = [];
      let prev = new Uint8Array(0);
      for (let i = 0; i < Math.ceil(len / 32); i++) {
        const hash = await prkh.hash(concatBytes([prev, info, new Uint8Array([i + 1])]));
        prev = new Uint8Array(hash);
        blocks.push(prev);
      }
      return concatBytes(blocks).slice(0, len);
    }
  };
}
async function deriveClientKeys(sub) {
  const bytes = b64urlToBytes(sub.keys.p256dh);
  const authSecretBytes = b64urlToBytes(sub.keys.auth);
  assert(bytes.byteLength === 65 && bytes[0] === 0x04, "p256dh inválido");
  assert(authSecretBytes.byteLength === 16, "auth inválido");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []),
    authSecretBytes
  };
}
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
async function encryptNotification(subscription, plaintext) {
  const recordSize = 4096;
  const headerSize = 21 + 65;
  const maxPlaintextSize = recordSize - headerSize - 17;
  assert(plaintext.byteLength <= maxPlaintextSize, "Payload demasiado grande");
  const clientKeys = await deriveClientKeys(subscription);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientKeys.publicKey },
    localKeys.privateKey,
    256
  );
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes), 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(createInfo("aes128gcm"), 16);
  const nonceBytes = await messageHkdf.extract(createInfo("nonce"), 12);
  const cek = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM", length: 128 }, false, ["encrypt"]);
  const padded = new Uint8Array(plaintext.byteLength + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 0x02;
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceBytes }, cek, padded);
  return concatBytes([
    salt,
    encodeRecordSize(recordSize),
    new Uint8Array([localKeys.publicKeyBytes.byteLength]),
    localKeys.publicKeyBytes,
    new Uint8Array(encrypted)
  ]);
}
async function signJwt(payload, key) {
  const header = bytesToB64url(strBytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(strBytes(JSON.stringify(Object.assign({ iat: Math.floor(Date.now() / 1000) }, payload))));
  const data = header + "." + body;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, strBytes(data));
  return data + "." + bytesToB64url(sig);
}
async function vapidAuth(subscription, vapid) {
  assert(vapid.subject, "Falta VAPID subject");
  assert(vapid.privateKey, "Falta VAPID private key");
  assert(vapid.publicKey, "Falta VAPID public key");
  const endpoint = new URL(subscription.endpoint);
  assert(endpoint.protocol === "https:", "Endpoint no https");
  const pubBytes = b64urlToBytes(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(pubBytes.slice(1, 33)),
      y: bytesToB64url(pubBytes.slice(33, 65)),
      d: vapid.privateKey
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const jwt = await signJwt({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject
  }, key);
  return "vapid t=" + jwt + ", k=" + vapid.publicKey;
}

/**
 * Send one Web Push. Returns { ok, gone } — gone means 404/410 (drop subscription).
 */
export async function sendWebPush(subscription, data, vapid, opts) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return { ok: false, gone: false };
  }
  const ttl = String((opts && opts.ttl) || 86400);
  const urgency = (opts && opts.urgency) || "high";
  const topic = opts && opts.topic ? String(opts.topic).slice(0, 32) : "";
  const plaintext = typeof data === "string" ? strBytes(data) : strBytes(JSON.stringify(data));
  const body = await encryptNotification(subscription, plaintext);
  const authorization = await vapidAuth(subscription, vapid);
  const headers = {
    Authorization: authorization,
    TTL: ttl,
    Urgency: urgency,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(body.byteLength)
  };
  if (topic) headers.Topic = topic;
  const res = await fetch(subscription.endpoint, { method: "POST", headers, body });
  if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
  if (res.status >= 200 && res.status < 300) return { ok: true, gone: false };
  return { ok: false, gone: false, status: res.status };
}
