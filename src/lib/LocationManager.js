/**
 * LocationManager — One-Time Location Capture (§14)
 *
 * Implements privacy-preserving, single-fix location capture.
 * NO continuous background tracking — only queried on explicit user trigger.
 *
 * Architecture Doc Reference: Section 14
 */
let Location = null;

try {
  Location = require('expo-location');
} catch (e) {
  console.warn('[LocationManager] expo-location not yet loaded:', e.message);
}

/**
 * Request foreground location permission.
 * @returns {Promise<boolean>}
 */
export async function requestLocationPermission() {
  if (!Location) {
    try { Location = require('expo-location'); } catch { return false; }
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[LocationManager] Permission request error:', e);
    return false;
  }
}

/**
 * Get single-fix current coordinates.
 * Never tracks continuously.
 *
 * @returns {Promise<{ lat: number, lng: number, accuracy: number }|null>}
 */
export async function getCurrentLocation() {
  if (!Location) {
    try { Location = require('expo-location'); } catch { return null; }
  }
  try {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      console.warn('[LocationManager] Location permission denied');
      return null;
    }

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy?.Balanced || 3,
    });

    return {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
    };
  } catch (e) {
    console.warn('[LocationManager] Failed to get current location:', e);
    return null;
  }
}
