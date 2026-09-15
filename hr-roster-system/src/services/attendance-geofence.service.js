const EARTH_RADIUS_METERS = 6371000;

function radians(value) { return Number(value) * Math.PI / 180; }

function calculateDistanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function evaluateGeofence(location = {}, geofence = {}) {
  if (location.failed) return { status: 'LOCATION_FAILED', distanceMeters: null, reason: String(location.reason || '定位失败').slice(0, 255) };
  const latitude = Number(location.latitude); const longitude = Number(location.longitude); const accuracy = Number(location.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy < 0) return { status: 'LOCATION_FAILED', distanceMeters: null, reason: '定位数据无效' };
  const distanceMeters = calculateDistanceMeters(latitude, longitude, Number(geofence.latitude), Number(geofence.longitude));
  if (accuracy > Number(geofence.maxAccuracyMeters || 100)) return { status: 'LOW_ACCURACY', distanceMeters, reason: '定位精度不足' };
  return { status: distanceMeters <= Number(geofence.radiusMeters) ? 'INSIDE' : 'OUTSIDE', distanceMeters, reason: '' };
}

module.exports = { calculateDistanceMeters, evaluateGeofence };
