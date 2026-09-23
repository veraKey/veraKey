import { formatUnits, parseUnits } from "viem";

export const USDG_DECIMALS = 6;

export function formatUsdg(units: bigint, digits = 2): string {
  const value = Number(formatUnits(units, USDG_DECIMALS));
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
}

export function parseUsdg(value: string): bigint | null {
  if (!/^\d+(\.\d{0,6})?$/.test(value.trim())) return null;
  try {
    return parseUnits(value.trim(), USDG_DECIMALS);
  } catch {
    return null;
  }
}

export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatGas(gas: bigint): string {
  return Number(gas).toLocaleString("en-US");
}
