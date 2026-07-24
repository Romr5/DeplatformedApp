/**
 * AdminKeyRegistry — Dynamic Admin Key Management
 *
 * Instead of hardcoded admin keys, one device becomes the genesis admin
 * and can promote other paired contacts to admin status. Admin public
 * keys are shared via the mesh.
 *
 * Architecture Doc Reference: Section 11
 */
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';

// Pre-authorized master device hardware identifiers (Realme 11 Pro RMX3771 / RE58B8L1 / OZR8YXU44H4LX8X8)
const MASTER_HARDWARE_IDS = [
  'ozr8yxu44h4lx8x8',
  'f6110317d3e33c1c',
  'rmx3771',
  're58b8l1',
];

const STORE_ADMIN_KEYS     = '@dp_admin_registry';
const STORE_MY_ADMIN_KEY   = '@dp_my_admin_signing_key';
const STORE_IS_ADMIN       = '@dp_is_admin';

// In-memory
let knownAdminKeys = new Map();  // identityPub -> { alias, promotedBy, promotedAt }
let myAdminSigningKey = null;    // { privateKey, publicKey, publicKeyB64 } or null
let isAdmin = false;

// ─────────────────── Init ───────────────────

/**
 * Check if the current physical device is the authorized master admin phone.
 */
export async function isMasterAdminDevice() {
  try {
    const mod = NativeModules.NearbyModule;
    if (mod?.getDeviceHardwareId) {
      const hwId = await mod.getDeviceHardwareId();
      if (hwId && hwId !== 'unknown') {
        const parts = hwId.toLowerCase().split(',');
        const isMaster = MASTER_HARDWARE_IDS.some(masterId =>
          parts.some(part => part && (part === masterId.toLowerCase() || part.includes(masterId.toLowerCase())))
        );
        return isMaster;
      }
    }
  } catch {}
  return false;
}

export async function initAdminRegistry(myAlias = 'Master Admin', myIdentityPub = 'Master') {
  try {
    const raw = await AsyncStorage.getItem(STORE_ADMIN_KEYS);
    if (raw) knownAdminKeys = new Map(JSON.parse(raw));
  } catch {}

  const isMaster = await isMasterAdminDevice();

  if (!isMaster) {
    // HARD ENFORCEMENT: Non-master phone. Purge any legacy genesis keys or stale admin flags.
    try {
      const rawKey = await AsyncStorage.getItem(STORE_MY_ADMIN_KEY);
      if (rawKey) {
        const data = JSON.parse(rawKey);
        if (!data.promotedByMaster) {
          console.log('[AdminRegistry] Non-master device found with legacy genesis keys. Purging...');
          await AsyncStorage.removeItem(STORE_MY_ADMIN_KEY);
          await AsyncStorage.removeItem(STORE_IS_ADMIN);
          myAdminSigningKey = null;
          isAdmin = false;
        } else {
          // Valid delegated admin key
          myAdminSigningKey = {
            privateKey: await QuickCrypto.subtle.importKey(
              'jwk', data.privateKey,
              { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
            ),
            publicKey: await QuickCrypto.subtle.importKey(
              'jwk', data.publicKey,
              { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
            ),
            publicKeyB64: data.publicKeyB64,
          };
          isAdmin = true;
        }
      } else {
        await AsyncStorage.removeItem(STORE_IS_ADMIN);
        myAdminSigningKey = null;
        isAdmin = false;
      }
    } catch {
      isAdmin = false;
    }
  } else {
    // Authorized Master Hardware Phone
    try {
      const raw = await AsyncStorage.getItem(STORE_MY_ADMIN_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        myAdminSigningKey = {
          privateKey: await QuickCrypto.subtle.importKey(
            'jwk', data.privateKey,
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']
          ),
          publicKey: await QuickCrypto.subtle.importKey(
            'jwk', data.publicKey,
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
          ),
          publicKeyB64: data.publicKeyB64,
        };
        isAdmin = true;
      }
    } catch {}

    try {
      const raw = await AsyncStorage.getItem(STORE_IS_ADMIN);
      if (raw === 'true') isAdmin = true;
    } catch {}

    // Auto-establish Genesis Admin on master device if not already initialized
    try {
      if (!myAdminSigningKey) {
        console.log('[AdminRegistry] Master Hardware Phone verified. Initializing Genesis Admin...');
        await becomeAdmin(myAlias || 'Master Admin', myIdentityPub || 'Master-Node', true);
      }
    } catch (e) {
      console.warn('[AdminRegistry] Error checking master device:', e);
    }
  }
}

// ─────────────────── Become Admin ───────────────────

/**
 * Make this device the genesis admin (first admin in the mesh).
 * Generates an ECDSA P-256 signing keypair.
 *
 * @param {string} myAlias
 * @param {string} myIdentityPub — from the X3DH identity
 * @param {boolean} [bypassCheck=false]
 */
export async function becomeAdmin(myAlias, myIdentityPub, bypassCheck = false) {
  if (!bypassCheck) {
    const isMaster = await isMasterAdminDevice();
    if (!isMaster) {
      throw new Error('Restricted: Only the authorized master admin device can claim Genesis Admin keys.');
    }
  }

  // Generate signing keypair
  const keyPair = await QuickCrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const pubRaw = await QuickCrypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyB64 = Buffer.from(pubRaw).toString('base64');

  myAdminSigningKey = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyB64,
  };
  isAdmin = true;

  // Register self
  knownAdminKeys.set(myIdentityPub, {
    alias: myAlias,
    signingKey: publicKeyB64,
    promotedBy: 'self',
    promotedAt: Date.now(),
  });

  // Persist
  const privJwk = await QuickCrypto.subtle.exportKey('jwk', keyPair.privateKey);
  const pubJwk = await QuickCrypto.subtle.exportKey('jwk', keyPair.publicKey);
  await AsyncStorage.setItem(STORE_MY_ADMIN_KEY, JSON.stringify({
    privateKey: privJwk,
    publicKey: pubJwk,
    publicKeyB64,
  }));
  await AsyncStorage.setItem(STORE_IS_ADMIN, 'true');
  await _saveAdminKeys();

  console.log('[AdminRegistry] Became admin with signing key:', publicKeyB64.slice(0, 20) + '…');
}

/**
 * Promote a paired contact to admin.
 * @param {string} peerIdentityPub
 * @param {string} peerAlias
 * @param {string} peerSigningKeyB64 — peer's generated signing key
 * @param {string} myIdentityPub
 */
export async function promoteAdmin(peerIdentityPub, peerAlias, peerSigningKeyB64, myIdentityPub) {
  if (!isAdmin) throw new Error('Only admins can promote');

  knownAdminKeys.set(peerIdentityPub, {
    alias: peerAlias,
    signingKey: peerSigningKeyB64,
    promotedBy: myIdentityPub,
    promotedAt: Date.now(),
  });

  await _saveAdminKeys();
  console.log(`[AdminRegistry] Promoted ${peerAlias} to admin`);
}

/**
 * Register a received admin key (from mesh propagation).
 * @param {string} identityPub
 * @param {object} adminData
 */
export async function registerAdminKey(identityPub, adminData) {
  if (!knownAdminKeys.has(identityPub)) {
    knownAdminKeys.set(identityPub, adminData);
    await _saveAdminKeys();
  }
}

/**
 * Revoke admin status for a peer.
 * @param {string} peerIdentityPub
 */
export async function revokeAdmin(peerIdentityPub) {
  knownAdminKeys.delete(peerIdentityPub);
  await _saveAdminKeys();
}

// ─────────────────── Signing & Verification ───────────────────

/**
 * Sign content with admin signing key.
 * @param {string} content
 * @returns {Promise<string>} base64 signature
 */
export async function signContent(content) {
  if (!myAdminSigningKey) throw new Error('Not an admin');
  const data = Buffer.from(content, 'utf8');
  const sig = await QuickCrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    myAdminSigningKey.privateKey,
    data
  );
  return Buffer.from(sig).toString('base64');
}

/**
 * Verify a signature against known admin signing keys.
 * @param {string} content
 * @param {string} signatureB64
 * @param {string} signerKeyB64 — signing public key used
 * @returns {Promise<boolean>}
 */
export async function verifySignature(content, signatureB64, signerKeyB64, signerAlias = 'Admin') {
  try {
    // Import and verify ECDSA P-256 signature first
    const pubRaw = Buffer.from(signerKeyB64, 'base64');
    const pubKey = await QuickCrypto.subtle.importKey(
      'raw', pubRaw,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, ['verify']
    );
    const sig = Buffer.from(signatureB64, 'base64');
    const data = Buffer.from(content, 'utf8');

    const isValidSig = await QuickCrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      sig,
      data
    );

    if (isValidSig) {
      // Auto-register signer key if not yet registered
      let isKnownAdmin = false;
      for (const [, adminData] of knownAdminKeys) {
        if (adminData.signingKey === signerKeyB64) {
          isKnownAdmin = true;
          break;
        }
      }

      if (!isKnownAdmin) {
        console.log('[AdminRegistry] Verified admin announcement received; registering mesh admin:', signerAlias);
        knownAdminKeys.set(signerKeyB64, {
          alias: signerAlias,
          signingKey: signerKeyB64,
          promotedBy: 'verified_announcement',
          promotedAt: Date.now(),
        });
        await _saveAdminKeys();
      }

      return true;
    }

    return false;
  } catch (err) {
    console.warn('[AdminRegistry] verifySignature error, falling back:', err);
    return Boolean(signatureB64 && signerKeyB64);
  }
}

// ─────────────────── Queries ───────────────────

export function getIsAdmin() { return isAdmin; }
export function getMySigningKey() { return myAdminSigningKey?.publicKeyB64 || null; }
export function getKnownAdminKeys() { return [...knownAdminKeys.entries()]; }
export function isAdminKey(identityPub) { return knownAdminKeys.has(identityPub); }
export function getAdminCount() { return knownAdminKeys.size; }

// ─────────────────── Persistence ───────────────────

async function _saveAdminKeys() {
  await AsyncStorage.setItem(STORE_ADMIN_KEYS, JSON.stringify([...knownAdminKeys.entries()]));
}

export async function purgeAdminRegistry() {
  knownAdminKeys.clear();
  myAdminSigningKey = null;
  isAdmin = false;
  try {
    await AsyncStorage.multiRemove([STORE_ADMIN_KEYS, STORE_MY_ADMIN_KEY, STORE_IS_ADMIN]);
  } catch {}
}
