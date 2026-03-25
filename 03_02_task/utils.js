export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function extractEccsCode(text) {
  const match = text.match(/ECCS-[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

export function extractFlag(text) {
  const match = text.match(/\{FLG:[^}]+\}/);
  return match ? match[0] : null;
}
