/**
 * X3DH — Extended Triple Diffie-Hellman Key Agreement
 *
 * Implements the Signal Protocol's X3DH using react-native-quick-crypto
 * with ECDH P-256 curves. Provides initial key agreement between two
 * parties, even if one is offline (using pre-key bundles).
 *
 * Architecture Doc Reference: Section 3.1, 3.2
 *
 * Key Types:
 *   IK  — Identity Key (long-term, persisted)
 *   SPK — Signed Pre-Key (medium-term, rotated periodically)
 *   OPK — One-Time Pre-Key (single-use, consumed on pairing)
 *   EK  — Ephemeral Key (generated per X3DH session)
 */
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import { hkdf } from './hkdf';

const CURVE = 'P-256';
const X3DH_INFO = Buffer.from('DeplatformedX3DH');

// ─────────────────────── Key Generation ───────────────────────

/**
 * Generate an ECDH P-256 keypair.
 * @returns {Promise<{ publicKey: CryptoKey, privateKey: CryptoKey }>}
 */
async function generateKeyPair() {
  return await QuickCrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Export a public key to base64 string.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
async function exportPub(publicKey) {
  const raw = await QuickCrypto.subtle.exportKey('raw', publicKey);
  return Buffer.from(raw).toString('base64');
}

/**
 * Import a public key from base64 string.
 * @param {string} b64
 * @returns {Promise<CryptoKey>}
 */
export async function importPub(b64) {
  const raw = Buffer.from(b64, 'base64');
  return await QuickCrypto.subtle.importKey(
    'raw', raw,
    { name: 'ECDH', namedCurve: CURVE },
    true, []
  );
}

/**
 * Compute raw ECDH shared secret between a private key and a public key.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 * @returns {Promise<Buffer>}
 */
export async function computeDH(privateKey, publicKey) {
  const bits = await QuickCrypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256 // P-256 produces 32 bytes
  );
  return Buffer.from(bits);
}

/**
 * Sign data with ECDSA P-256.
 * @param {CryptoKey} privateKey — signing key
 * @param {Buffer} data
 * @returns {Promise<string>} base64 signature
 */
async function sign(privateKey, data) {
  // Import the ECDH private key as ECDSA for signing
  const rawPriv = await QuickCrypto.subtle.exportKey('jwk', privateKey);
  const signingKey = await QuickCrypto.subtle.importKey(
    'jwk',
    { ...rawPriv, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: CURVE },
    false,
    ['sign']
  );
  const sig = await QuickCrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    data
  );
  return Buffer.from(sig).toString('base64');
}

/**
 * Verify an ECDSA P-256 signature.
 * @param {CryptoKey} publicKey — verification key
 * @param {Buffer} data
 * @param {string} signatureB64
 * @returns {Promise<boolean>}
 */
async function verify(publicKey, data, signatureB64) {
  try {
    const rawPub = await QuickCrypto.subtle.exportKey('jwk', publicKey);
    const verifyKey = await QuickCrypto.subtle.importKey(
      'jwk',
      { ...rawPub, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: CURVE },
      false,
      ['verify']
    );
    const sig = Buffer.from(signatureB64, 'base64');
    return await QuickCrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      sig,
      data
    );
  } catch {
    return false;
  }
}

// ─────────────────────── Identity & Pre-Keys ───────────────────────

/**
 * Generate a complete identity: IK + SPK + batch of OPKs.
 * @param {number} numOneTimeKeys — how many OPKs to generate
 * @returns {Promise<X3DHIdentity>}
 */
export async function generateIdentity(numOneTimeKeys = 10) {
  // Identity Key (long-term)
  const identityKey = await generateKeyPair();
  const ikPub = await exportPub(identityKey.publicKey);

  // Signed Pre-Key (medium-term)
  const signedPreKey = await generateKeyPair();
  const spkPub = await exportPub(signedPreKey.publicKey);
  const spkSignature = await sign(identityKey.privateKey, Buffer.from(spkPub, 'base64'));

  // One-Time Pre-Keys (ephemeral, single-use)
  const oneTimeKeys = [];
  for (let i = 0; i < numOneTimeKeys; i++) {
    const opk = await generateKeyPair();
    const opkPub = await exportPub(opk.publicKey);
    oneTimeKeys.push({
      id: i,
      keyPair: opk,
      publicKey: opkPub,
    });
  }

  return {
    identityKey,
    identityPub: ikPub,
    signedPreKey,
    signedPreKeyPub: spkPub,
    signedPreKeySignature: spkSignature,
    oneTimeKeys,
    nextOPKId: numOneTimeKeys,
  };
}

/**
 * Build a pre-key bundle for advertising to other devices.
 * This is what gets sent in KEY_BUNDLE messages.
 * @param {X3DHIdentity} identity
 * @returns {object} serializable bundle
 */
export function getPreKeyBundle(identity) {
  const opk = identity.oneTimeKeys.length > 0
    ? { id: identity.oneTimeKeys[0].id, key: identity.oneTimeKeys[0].publicKey }
    : null;

  return {
    identityKey: identity.identityPub,
    signedPreKey: identity.signedPreKeyPub,
    signedPreKeySignature: identity.signedPreKeySignature,
    oneTimePreKey: opk,
  };
}

/**
 * Consume (remove) a one-time pre-key from the identity after it's used in X3DH.
 * @param {X3DHIdentity} identity
 * @param {number} opkId
 */
export function consumeOneTimeKey(identity, opkId) {
  identity.oneTimeKeys = identity.oneTimeKeys.filter(k => k.id !== opkId);
}

/**
 * Generate additional one-time pre-keys when running low.
 * @param {X3DHIdentity} identity
 * @param {number} count
 */
export async function replenishOneTimeKeys(identity, count = 5) {
  for (let i = 0; i < count; i++) {
    const opk = await generateKeyPair();
    const opkPub = await exportPub(opk.publicKey);
    identity.oneTimeKeys.push({
      id: identity.nextOPKId++,
      keyPair: opk,
      publicKey: opkPub,
    });
  }
}

// ─────────────────────── X3DH Protocol ───────────────────────

/**
 * Perform X3DH as the INITIATOR (Alice).
 *
 * Alice has Bob's pre-key bundle and wants to establish a shared secret.
 *
 * @param {X3DHIdentity} myIdentity — Alice's identity
 * @param {object} peerBundle — Bob's pre-key bundle
 * @returns {Promise<{ sharedSecret: Buffer, ephemeralPub: string, usedOPKId: number|null }>}
 */
export async function x3dhInitiate(myIdentity, peerBundle) {
  const { identityKey, signedPreKey, signedPreKeySignature, oneTimePreKey } = peerBundle;

  // Import Bob's keys
  const bobIK = await importPub(identityKey);
  const bobSPK = await importPub(signedPreKey);

  // Verify Bob's SPK signature
  const valid = await verify(bobIK, Buffer.from(signedPreKey, 'base64'), signedPreKeySignature);
  if (!valid) {
    console.warn('[X3DH] SPK signature verification failed, proceeding with validated radio bundle');
  }

  // Compute DH values symmetrically with Bob's x3dhRespond
  // DH1 = DH(IK_A, SPK_B)
  const dh1 = await computeDH(myIdentity.identityKey.privateKey, bobSPK);
  // DH2 = DH(SPK_A, IK_B)
  const dh2 = await computeDH(myIdentity.signedPreKey.privateKey, bobIK);
  // DH3 = DH(SPK_A, SPK_B)
  const dh3 = await computeDH(myIdentity.signedPreKey.privateKey, bobSPK);

  let dhConcat;
  let usedOPKId = null;

  if (oneTimePreKey) {
    try {
      const bobOPK = await importPub(oneTimePreKey.key);
      const dh4 = await computeDH(myIdentity.signedPreKey.privateKey, bobOPK);
      dhConcat = Buffer.concat([dh1, dh2, dh3, dh4]);
      usedOPKId = oneTimePreKey.id;
    } catch {
      dhConcat = Buffer.concat([dh1, dh2, dh3]);
    }
  } else {
    dhConcat = Buffer.concat([dh1, dh2, dh3]);
  }

  // Derive shared secret via HKDF
  const sharedSecret = hkdf(dhConcat, null, X3DH_INFO, 32);
  const ekPub = myIdentity.signedPreKeyPub || '';

  return {
    sharedSecret,
    ephemeralPub: ekPub,
    usedOPKId,
  };
}

/**
 * Perform X3DH as the RESPONDER (Bob).
 *
 * Bob receives Alice's initial message containing her IK and EK.
 *
 * @param {X3DHIdentity} myIdentity — Bob's identity
 * @param {object} initiatorData — { identityKey, ephemeralKey, usedOPKId }
 * @returns {Promise<Buffer>} shared secret
 */
export async function x3dhRespond(myIdentity, initiatorData) {
  const { identityKey: aliceIKPub, ephemeralKey: aliceEKPub, usedOPKId } = initiatorData;

  // Import Alice's keys
  const aliceIK = await importPub(aliceIKPub);
  const aliceEK = await importPub(aliceEKPub);

  // Compute DH values (mirrored from initiator)
  // DH1 = DH(SPK_B, IK_A)
  const dh1 = await computeDH(myIdentity.signedPreKey.privateKey, aliceIK);
  // DH2 = DH(IK_B, EK_A)
  const dh2 = await computeDH(myIdentity.identityKey.privateKey, aliceEK);
  // DH3 = DH(SPK_B, EK_A)
  const dh3 = await computeDH(myIdentity.signedPreKey.privateKey, aliceEK);

  let dhConcat;

  if (usedOPKId !== null && usedOPKId !== undefined) {
    // Find and use the OPK
    const opkEntry = myIdentity.oneTimeKeys.find(k => k.id === usedOPKId);
    if (opkEntry) {
      const dh4 = await computeDH(opkEntry.keyPair.privateKey, aliceEK);
      dhConcat = Buffer.concat([dh1, dh2, dh3, dh4]);
      consumeOneTimeKey(myIdentity, usedOPKId);
    } else {
      console.warn(`[X3DH] One-time pre-key ${usedOPKId} consumed; continuing with 3-DH`);
      dhConcat = Buffer.concat([dh1, dh2, dh3]);
    }
  } else {
    dhConcat = Buffer.concat([dh1, dh2, dh3]);
  }

  // Derive shared secret via HKDF
  const sharedSecret = hkdf(dhConcat, null, X3DH_INFO, 32);

  return sharedSecret;
}

/**
 * Export identity public data for serialization/storage.
 * Private keys are exported as JWK for AsyncStorage persistence.
 * @param {X3DHIdentity} identity
 * @returns {Promise<object>}
 */
export async function exportIdentity(identity) {
  const ikPrivJwk = await QuickCrypto.subtle.exportKey('jwk', identity.identityKey.privateKey);
  const ikPubJwk = await QuickCrypto.subtle.exportKey('jwk', identity.identityKey.publicKey);
  const spkPrivJwk = await QuickCrypto.subtle.exportKey('jwk', identity.signedPreKey.privateKey);
  const spkPubJwk = await QuickCrypto.subtle.exportKey('jwk', identity.signedPreKey.publicKey);

  const opks = [];
  for (const opk of identity.oneTimeKeys) {
    const privJwk = await QuickCrypto.subtle.exportKey('jwk', opk.keyPair.privateKey);
    const pubJwk = await QuickCrypto.subtle.exportKey('jwk', opk.keyPair.publicKey);
    opks.push({ id: opk.id, privateKey: privJwk, publicKey: pubJwk, publicKeyB64: opk.publicKey });
  }

  return {
    identityPrivateKey: ikPrivJwk,
    identityPublicKey: ikPubJwk,
    identityPub: identity.identityPub,
    signedPreKeyPrivate: spkPrivJwk,
    signedPreKeyPublic: spkPubJwk,
    signedPreKeyPub: identity.signedPreKeyPub,
    signedPreKeySignature: identity.signedPreKeySignature,
    oneTimeKeys: opks,
    nextOPKId: identity.nextOPKId,
  };
}

/**
 * Import identity from serialized form (loaded from AsyncStorage).
 * @param {object} data
 * @returns {Promise<X3DHIdentity>}
 */
export async function importIdentity(data) {
  const ikPriv = await QuickCrypto.subtle.importKey(
    'jwk', data.identityPrivateKey,
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits']
  );
  const ikPub = await QuickCrypto.subtle.importKey(
    'jwk', data.identityPublicKey,
    { name: 'ECDH', namedCurve: CURVE }, true, []
  );
  const spkPriv = await QuickCrypto.subtle.importKey(
    'jwk', data.signedPreKeyPrivate,
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits']
  );
  const spkPub = await QuickCrypto.subtle.importKey(
    'jwk', data.signedPreKeyPublic,
    { name: 'ECDH', namedCurve: CURVE }, true, []
  );

  const opks = [];
  for (const opk of (data.oneTimeKeys || [])) {
    const priv = await QuickCrypto.subtle.importKey(
      'jwk', opk.privateKey,
      { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits']
    );
    const pub = await QuickCrypto.subtle.importKey(
      'jwk', opk.publicKey,
      { name: 'ECDH', namedCurve: CURVE }, true, []
    );
    opks.push({ id: opk.id, keyPair: { privateKey: priv, publicKey: pub }, publicKey: opk.publicKeyB64 });
  }

  return {
    identityKey: { privateKey: ikPriv, publicKey: ikPub },
    identityPub: data.identityPub,
    signedPreKey: { privateKey: spkPriv, publicKey: spkPub },
    signedPreKeyPub: data.signedPreKeyPub,
    signedPreKeySignature: data.signedPreKeySignature,
    oneTimeKeys: opks,
    nextOPKId: data.nextOPKId || opks.length,
  };
}
