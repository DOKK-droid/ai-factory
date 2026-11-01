export function formatAttempts(attempts, max = 5) {
  return \`${Math.min(attempts, max)}/${max}\`;
}
