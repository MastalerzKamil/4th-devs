import { TASK, VERIFY_URL } from "./taskConfig.js";

export async function postFilesystem(apikey, answer) {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer }),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { parseError: true, raw: raw.slice(0, 4000) };
  }

  return {
    httpOk: res.ok,
    status: res.status,
    data,
  };
}
