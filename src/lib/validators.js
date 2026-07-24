/**
 * Validators & Security Hardening (§9)
 *
 * Implements:
 * - Schema validation for typed protocol messages
 * - Payload size boundaries (prevent buffer exhaustion attacks)
 * - Safe JSON parsing and text sanitization (prevent XSS / injection)
 *
 * Architecture Doc Reference: Section 9
 */

export const MAX_PAYLOAD_SIZE = 64 * 1024; // 64 KB per envelope
export const MAX_TEXT_LENGTH   = 2000;      // max chars for chat / bulletin text
export const MAX_ALIAS_LENGTH  = 32;

const KNOWN_MESSAGE_TYPES = new Set([
  'HELLO', 'KEY', 'KEY_BUNDLE', 'CONNECT_REQUEST', 'X3DH_RESPONSE',
  'MSG', 'BULLETIN',
  'SENDER_KEY_DIST', 'ROOM_INVITE', 'ROOM_REMOVED', 'ROOM_MEMBER_LEFT', 'ROOM_MSG',
  'ADMIN_BROADCAST', 'ADMIN_PROMOTION',
  'HELP_REQUEST', 'HELP_RESOLVED',
]);

/**
 * Sanitize user-provided text string.
 * Trims excess whitespace, caps max length, strips control characters.
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function sanitizeText(text, maxLen = MAX_TEXT_LENGTH) {
  if (typeof text !== 'string') return '';
  // Remove ASCII control characters except newline and tab
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.trim().slice(0, maxLen);
}

/**
 * Validate incoming raw payload size before parsing or buffering.
 *
 * @param {string|Buffer|ArrayBuffer} rawData
 * @returns {boolean}
 */
export function validatePayloadSize(rawData) {
  if (!rawData) return false;
  let byteLen = 0;
  if (typeof rawData === 'string') {
    byteLen = rawData.length;
  } else if (rawData.byteLength != null) {
    byteLen = rawData.byteLength;
  } else if (rawData.length != null) {
    byteLen = rawData.length;
  }
  return byteLen <= MAX_PAYLOAD_SIZE;
}

/**
 * Safely parse JSON with size and syntax guards.
 *
 * @param {string} jsonString
 * @returns {object|null}
 */
export function safeJsonParse(jsonString) {
  if (!validatePayloadSize(jsonString)) {
    console.warn(`[Validators] Dropping oversized payload (${jsonString?.length} bytes)`);
    return null;
  }
  try {
    const obj = JSON.parse(jsonString);
    if (obj && typeof obj === 'object') {
      return obj;
    }
    return null;
  } catch (e) {
    console.warn('[Validators] Malformed JSON payload dropped');
    return null;
  }
}

/**
 * Validate that a parsed message satisfies the protocol schema.
 *
 * @param {object} msg
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessageSchema(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message must be a non-null object' };
  }

  if (!msg.type || typeof msg.type !== 'string') {
    return { valid: false, error: 'Missing or invalid message type' };
  }

  if (!KNOWN_MESSAGE_TYPES.has(msg.type)) {
    return { valid: false, error: `Unknown message type: ${msg.type}` };
  }

  // Type-specific field checks
  switch (msg.type) {
    case 'CONNECT_REQUEST':
      if (!msg.preKeyBundle) return { valid: false, error: 'Missing preKeyBundle in CONNECT_REQUEST' };
      break;

    case 'X3DH_RESPONSE':
      if (!msg.ephemeralPub || !msg.identityPub) {
        return { valid: false, error: 'Missing ephemeralPub or identityPub in X3DH_RESPONSE' };
      }
      break;

    case 'MSG':
      if (!msg.id || (!msg.text && !msg.ct)) {
        return { valid: false, error: 'Invalid MSG structure' };
      }
      break;

    case 'ADMIN_BROADCAST':
      if (!msg.post || !msg.post.signature || !msg.post.signingKey) {
        return { valid: false, error: 'Invalid ADMIN_BROADCAST structure' };
      }
      break;

    case 'HELP_REQUEST':
      if (!msg.reqId || !msg.tier) {
        return { valid: false, error: 'Invalid HELP_REQUEST structure' };
      }
      break;
  }

  return { valid: true };
}
