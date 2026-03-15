const PACKAGES_URL = "https://hub.ag3nts.org/api/packages";

/**
 * @param {string} apikey - HUB_APIKEY (ag3nts — paczki, nie OpenRouter)
 * @param {object} body
 */
export const postPackages = async (apikey, body) => {
  const response = await fetch(PACKAGES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, ...body }),
    signal: AbortSignal.timeout(20_000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? `packages API ${response.status}`);
  }

  return data;
};
