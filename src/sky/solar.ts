/**
 * Solar position, NOAA algorithm.
 *
 * We only need elevation to a fraction of a degree — enough to pick a sky tone,
 * not to point a telescope. Formulas follow the NOAA Solar Calculator
 * (Meeus, "Astronomical Algorithms").
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SolarPosition {
  /** Degrees above the horizon. Negative means the sun has set. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

function toJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function julianCentury(julian: number): number {
  return (julian - 2451545) / 36525;
}

export function solarPosition(date: Date, latitude: number, longitude: number): SolarPosition {
  const jc = julianCentury(toJulian(date));

  // Geometric mean longitude and anomaly of the sun.
  const meanLongitude = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);

  const eccentricity = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  // Equation of centre.
  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;

  const trueLongitude = meanLongitude + center;

  // Apparent longitude, correcting for nutation and aberration.
  const omega = 125.04 - 1934.136 * jc;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity =
    23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) * DEG;

  // Equation of time, in minutes.
  const y = Math.tan((obliquity * RAD) / 2) ** 2;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * meanLongitude * RAD) -
      2 * eccentricity * Math.sin(meanAnomaly * RAD) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD) -
      0.5 * y * y * Math.sin(4 * meanLongitude * RAD) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD));

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (utcMinutes + equationOfTime + 4 * longitude + 1440) % 1440;

  const hourAngle = trueSolarTime / 4 - 180;

  const latRad = latitude * RAD;
  const decRad = declination * RAD;
  const haRad = hourAngle * RAD;

  const cosZenith =
    Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
  const elevation = 90 - zenith;

  const cosAzimuth =
    (Math.sin(latRad) * Math.cos(zenith * RAD) - Math.sin(decRad)) /
    (Math.cos(latRad) * Math.sin(zenith * RAD));
  let azimuth = Math.acos(Math.min(1, Math.max(-1, cosAzimuth))) * DEG;
  azimuth = hourAngle > 0 ? (azimuth + 180) % 360 : (540 - azimuth) % 360;

  return { elevation, azimuth };
}

export type SkyPhase = 'night' | 'dawn' | 'day' | 'dusk';

export function skyPhase(elevation: number, azimuth: number): SkyPhase {
  if (elevation <= -6) return 'night';
  if (elevation > 6) return 'day';
  // Rising sun sits east-ish, setting sun west-ish.
  return azimuth < 180 ? 'dawn' : 'dusk';
}

export const PHASE_LABEL: Record<SkyPhase, string> = {
  night: 'gece',
  dawn: 'şafak',
  day: 'gündüz',
  dusk: 'gün batımı',
};
