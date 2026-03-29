import { HUB_BASE, API_KEY, TASK } from './config.js';

// ─── Hub API helpers ──────────────────────────────────────────────────────────

export async function toolSearch(query) {
  const res = await fetch(`${HUB_BASE}/api/toolsearch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, query }),
  });
  if (!res.ok) throw new Error(`toolsearch HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function callTool(endpoint, query) {
  // endpoint is a relative path like "/api/maps" or a full URL
  const url = endpoint.startsWith('http') ? endpoint : `${HUB_BASE}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, query }),
  });
  if (!res.ok) throw new Error(`tool ${endpoint} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function submitAnswer(answer) {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer }),
  });
  if (!res.ok) throw new Error(`verify HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}
