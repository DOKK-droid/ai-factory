export function clamp(value, min, max) {
  if (min > max) {
    throw new RangeError('min must be less than or equal to max');
  }

  return Math.min(Math.max(value, min), max);
}
