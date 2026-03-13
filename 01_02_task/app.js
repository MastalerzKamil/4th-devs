import { readFile } from "fs/promises";

const INPUT_PATH = new URL("./output.json", import.meta.url);
const VERIFY_URL = "https://hub.ag3nts.org/verify";
const LOCATION_URL = "https://hub.ag3nts.org/api/location";
const ACCESS_LEVEL_URL = "https://hub.ag3nts.org/api/accesslevel";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

const PLANT_NAME_ALIASES = {
  Chelmno: "Chełmno",
};

const PLANT_LOCATION_HINTS = {
  Chelmno: (result) => result.admin1?.toLowerCase().includes("kujawsko"),
  "Żarnowiec": (result) => result.admin1?.toLowerCase().includes("pomorsk"),
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message ?? `Request failed: ${response.status} ${response.statusText}`);
  }

  return data;
};

const postJson = (url, body) =>
  requestJson(url, {
    method: "POST",
    body: JSON.stringify(body),
  });

const normalizePlantName = (city) => (PLANT_NAME_ALIASES[city] ?? city).normalize("NFC");

const pickPlantCoordinates = (city, results = []) => {
  if (results.length === 0) {
    throw new Error(`No geocoding results for "${city}"`);
  }

  const locationHint = PLANT_LOCATION_HINTS[city];

  if (locationHint) {
    const hintedResult = results.find(locationHint);

    if (hintedResult) {
      return hintedResult;
    }
  }

  return results[0];
};

const geocodePlant = async (city) => {
  const query = normalizePlantName(city);
  const params = new URLSearchParams({
    name: query,
    count: "10",
    language: "pl",
    format: "json",
  });

  const data = await requestJson(`${GEOCODING_URL}?${params.toString()}`, {
    headers: {
      // Public geocoding endpoint requires a non-empty user agent in some environments.
      "User-Agent": "ai-devs-findhim-solver/1.0",
    },
  });

  const picked = pickPlantCoordinates(city, data.results ?? []);

  return {
    city,
    latitude: picked.latitude,
    longitude: picked.longitude,
  };
};

const haversineDistanceKm = (pointA, pointB) => {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const lat1 = toRadians(pointA.latitude);
  const lat2 = toRadians(pointB.latitude);
  const deltaLat = toRadians(pointB.latitude - pointA.latitude);
  const deltaLon = toRadians(pointB.longitude - pointA.longitude);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
};

const readInput = async () => {
  const raw = await readFile(INPUT_PATH, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data.answer) || typeof data.apikey !== "string") {
    throw new Error("Invalid input file: expected apikey and answer[]");
  }

  return data;
};

const fetchPowerPlants = async (apiKey) => {
  const url = `https://hub.ag3nts.org/data/${apiKey}/findhim_locations.json`;
  const data = await requestJson(url, {
    headers: {
      "User-Agent": "ai-devs-findhim-solver/1.0",
    },
  });

  const plants = data.power_plants ?? {};
  const entries = Object.entries(plants);

  return Promise.all(
    entries.map(async ([city, details]) => ({
      city,
      code: details.code,
      isActive: details.is_active,
      power: details.power,
      ...(await geocodePlant(city)),
    }))
  );
};

const fetchLocationsForSuspect = async (apiKey, suspect) =>
  postJson(LOCATION_URL, {
    apikey: apiKey,
    name: suspect.name,
    surname: suspect.surname,
  });

const fetchAccessLevel = async (apiKey, suspect) =>
  postJson(ACCESS_LEVEL_URL, {
    apikey: apiKey,
    name: suspect.name,
    surname: suspect.surname,
    birthYear: suspect.born,
  });

const findBestMatch = async (apiKey, suspects, plants) => {
  let bestMatch = null;

  for (const suspect of suspects) {
    const locations = await fetchLocationsForSuspect(apiKey, suspect);

    for (const location of locations) {
      for (const plant of plants) {
        const distanceKm = haversineDistanceKm(location, plant);

        if (!bestMatch || distanceKm < bestMatch.distanceKm) {
          bestMatch = {
            suspect,
            plant,
            location,
            distanceKm,
          };
        }
      }
    }
  }

  if (!bestMatch) {
    throw new Error("No suspect locations were returned");
  }

  return bestMatch;
};

const verifyAnswer = async (apiKey, answer) =>
  postJson(VERIFY_URL, {
    apikey: apiKey,
    task: "findhim",
    answer,
  });

const main = async () => {
  const dryRun = process.argv.includes("--dry-run");
  const input = await readInput();
  const plants = await fetchPowerPlants(input.apikey);
  const bestMatch = await findBestMatch(input.apikey, input.answer, plants);
  const accessLevelResponse = await fetchAccessLevel(input.apikey, bestMatch.suspect);

  const answer = {
    name: bestMatch.suspect.name,
    surname: bestMatch.suspect.surname,
    accessLevel: accessLevelResponse.accessLevel,
    powerPlant: bestMatch.plant.code,
  };

  console.log("Best match:");
  console.log(JSON.stringify({
    ...answer,
    plantCity: bestMatch.plant.city,
    distanceKm: Number(bestMatch.distanceKm.toFixed(3)),
    location: bestMatch.location,
  }, null, 2));

  if (dryRun) {
    return;
  }

  const verification = await verifyAnswer(input.apikey, answer);
  console.log("\nVerification:");
  console.log(JSON.stringify(verification, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
