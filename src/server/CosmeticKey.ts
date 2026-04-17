export function normalizeCosmeticKey(input: string): string {
  const safe = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : "item";
}