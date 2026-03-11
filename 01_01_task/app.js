import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import { loadCsv } from "./parseCsv.js";
import { AI_API_KEY, AI_PROVIDER } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_CSV = path.join(__dirname, "people.csv");
const OUTPUT_JSON = path.join(__dirname, "output.json");

const BATCH_SIZE = 20;
const CURRENT_YEAR = 2026;
const MIN_AGE = 20;
const MAX_AGE = 40;
const TARGET_BIRTHPLACE = "Grudziądz";
const TRANSPORTATION_KEYWORDS = [
  "transport",
  "transportu",
  "towary",
  "towarów",
  "towarami",
  "logistics",
  "logistyk",
  "delivery",
  "dostarczać",
  "shipping",
  "wysyłk",
  "cargo",
  "ładunek",
  "freight",
  "route",
  "trasa",
  "driver",
  "kierowca",
  "vehicle",
  "pojazd",
  "pojazdu",
  "truck",
  "ciężarówa",
  "bus",
  "supply",
  "zaopatrzeni",
  "warehouse",
  "magazyn",
  "distribution",
  "dystrybucj",
  "przewóz",
  "przewoźnik",
  "przepływ",
  "przepływem",
  "ruch towarowy",
  "materiały trafiały",
  "zarządzaniem ruchem"
];

const ALLOWED_TAGS = [
  "IT",
  "transport",
  "edukacja",
  "medycyna",
  "praca z ludźmi",
  "praca z pojazdami",
  "praca fizyczna"
];

// Zod schema for structured output
const PersonTagSchema = z.object({
  name: z.string().describe("First name of the person"),
  surname: z.string().describe("Surname of the person"),
  gender: z.enum(["M", "F"]).describe("Gender: M or F"),
  born: z.number().int().describe("Birth year as integer (e.g., 1987)"),
  city: z.string().describe("City of birth"),
  tags: z
    .array(z.string())
    .describe(
      "Tags from Polish list: IT, transport, edukacja, medycyna, praca z ludźmi, praca z pojazdami, praca fizyczna"
    )
});

const PeopleBatchSchema = z.object({
  people: z.array(PersonTagSchema).describe("Array of tagged people")
});

// Initialize OpenRouter client with Instructor
const createInstructorClient = () => {
  const baseClient = new OpenAI({
    apiKey: AI_API_KEY,
    baseURL:
      AI_PROVIDER === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1",
    defaultHeaders:
      AI_PROVIDER === "openrouter"
        ? {
            "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://localhost",
            "X-Title": process.env.OPENROUTER_APP_NAME || "ai-devs-task"
          }
        : {}
  });

  return Instructor({
    client: baseClient,
    mode: "TOOLS"
  });
};

function isInTransportationIndustry(jobDescription) {
  const lowerDesc = jobDescription.toLowerCase();
  return TRANSPORTATION_KEYWORDS.some((keyword) => lowerDesc.includes(keyword));
}

function meetsAgeRange(birthYear) {
  if (!birthYear || Number.isNaN(birthYear)) return false;
  const age = CURRENT_YEAR - birthYear;
  return age >= MIN_AGE && age <= MAX_AGE;
}

function filterPeople(people) {
  return people.filter((person) => {
    // Gender: male
    if (person.gender !== "M") return false;

    // Age: 20-40 years old in 2026
    const birthYear = person.birthDate ? parseInt(person.birthDate.slice(0, 4), 10) : null;
    if (!meetsAgeRange(birthYear)) return false;

    // Birth place: Grudziądz
    if (person.birthPlace !== TARGET_BIRTHPLACE) return false;

    // Transportation industry
    if (!isInTransportationIndustry(person.job)) return false;

    return true;
  });
}

function filterTagsByAllowedList(tags) {
  const filtered = [];

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();

    // Check for exact or partial matches with allowed tags
    if (ALLOWED_TAGS.some((allowed) => lowerTag.includes(allowed.toLowerCase()))) {
      filtered.push(tag);
      continue;
    }

    // Additional heuristics for tag mapping to Polish categories
    if (
      lowerTag.includes("logistics") ||
      lowerTag.includes("supply") ||
      lowerTag.includes("warehouse") ||
      lowerTag.includes("cargo") ||
      lowerTag.includes("freight") ||
      lowerTag.includes("transport")
    ) {
      filtered.push("transport");
    } else if (
      lowerTag.includes("driver") ||
      lowerTag.includes("truck") ||
      lowerTag.includes("bus") ||
      lowerTag.includes("vehicle") ||
      lowerTag.includes("pojazd") ||
      lowerTag.includes("kierowca")
    ) {
      filtered.push("praca z pojazdami");
    } else if (
      lowerTag.includes("physical") ||
      lowerTag.includes("manual") ||
      lowerTag.includes("fizycz")
    ) {
      filtered.push("praca fizyczna");
    } else if (
      lowerTag.includes("education") ||
      lowerTag.includes("teaching") ||
      lowerTag.includes("eduk")
    ) {
      filtered.push("edukacja");
    } else if (
      lowerTag.includes("health") ||
      lowerTag.includes("medical") ||
      lowerTag.includes("doctor") ||
      lowerTag.includes("medycz")
    ) {
      filtered.push("medycyna");
    } else if (
      lowerTag.includes("people") ||
      lowerTag.includes("customer") ||
      lowerTag.includes("client") ||
      lowerTag.includes("interpersonal") ||
      lowerTag.includes("ludź")
    ) {
      filtered.push("praca z ludźmi");
    } else if (
      lowerTag.includes("software") ||
      lowerTag.includes("programming") ||
      lowerTag.includes("developer") ||
      lowerTag.includes("engineer") ||
      lowerTag.includes("algorithm") ||
      lowerTag.includes("code")
    ) {
      filtered.push("IT");
    }
  }

  // Remove duplicates
  return Array.from(new Set(filtered));
}

function buildBatchPrompt(people) {
  const lines = people.map((p, i) => {
    const birthYear = p.birthDate ? p.birthDate.slice(0, 4) : "unknown";
    return `[${i + 1}] ${p.name} ${p.surname}, Gender: ${p.gender}, Birth: ${p.birthDate} (year: ${birthYear}), Birthplace: ${p.birthPlace}, Country: ${p.birthCountry}. Job: ${p.job}`;
  });

  return `Extract structured person data for each person below. For tags, only use these Polish categories: ${ALLOWED_TAGS.join(", ")}. Keep exact same order.\n\n${lines.join("\n\n")}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function tagBatchWithInstructor(client, people) {
  const input = buildBatchPrompt(people);

  try {
    const response = await client.chat.completions.create({
      messages: [
        {
          role: "user",
          content: input
        }
      ],
      model: AI_PROVIDER === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini",
      response_model: {
        schema: PeopleBatchSchema,
        name: "PeopleBatch"
      }
    });

    return response.people.map((item) => ({
      name: item.name,
      surname: item.surname,
      gender: item.gender,
      born: typeof item.born === "number" ? item.born : parseInt(String(item.born), 10),
      city: item.city,
      tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : []
    }));
  } catch (error) {
    console.error("Error during batch tagging:", error.message);
    throw error;
  }
}

async function main() {
  console.log("Initializing Instructor client...");
  const client = createInstructorClient();

  console.log("Loading people from", PEOPLE_CSV);
  let people = await loadCsv(PEOPLE_CSV);
  const maxPeople = process.env.MAX_PEOPLE ? parseInt(process.env.MAX_PEOPLE, 10) : null;
  if (maxPeople != null && !Number.isNaN(maxPeople) && maxPeople > 0) {
    people = people.slice(0, maxPeople);
    console.log("Limited to first", people.length, "people (MAX_PEOPLE). Batch size:", BATCH_SIZE);
  } else {
    console.log("Loaded", people.length, "people. Batch size:", BATCH_SIZE);
  }

  // Filter people based on criteria
  console.log("\nApplying filters:");
  console.log("  - Gender: Male");
  console.log(`  - Age: ${MIN_AGE}-${MAX_AGE} years old (year ${CURRENT_YEAR})`);
  console.log(`  - Birthplace: ${TARGET_BIRTHPLACE}`);
  console.log("  - Industry: Transportation");
  const filtered = filterPeople(people);
  console.log(`Found ${filtered.length} people matching all criteria\n`);

  if (filtered.length === 0) {
    console.log("No people match the filter criteria.");
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
    const output = {
      apikey: apiKey.slice(0, 20) + "...",
      task: "people",
      answer: []
    };
    await writeFile(OUTPUT_JSON, JSON.stringify(output, null, 2), "utf8");
    console.log("Wrote", OUTPUT_JSON);
    return;
  }

  const batches = chunk(filtered, BATCH_SIZE);
  const results = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`Batch ${b + 1}/${batches.length} (${batch.length} people)`);

    try {
      const tagged = await tagBatchWithInstructor(client, batch);

      for (let i = 0; i < batch.length; i++) {
        const allTags = tagged[i].tags;
        const filteredTags = filterTagsByAllowedList(allTags);

        results.push({
          name: tagged[i].name,
          surname: tagged[i].surname,
          gender: tagged[i].gender,
          born: tagged[i].born,
          city: tagged[i].city,
          tags: filteredTags
        });
      }
    } catch (error) {
      console.error(`Failed to process batch ${b + 1}:`, error.message);
      throw error;
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
  const output = {
    apikey: apiKey.slice(0, 20) + "...",
    task: "people",
    answer: results
  };

  await writeFile(OUTPUT_JSON, JSON.stringify(output, null, 2), "utf8");
  console.log("Wrote", OUTPUT_JSON);

  const sample = results.slice(0, 3);
  console.log(`\nSample (first ${Math.min(3, results.length)}):`);
  sample.forEach((p) =>
    console.log(
      `  ${p.name} ${p.surname} (born ${p.born}, ${p.city}): tags=[${p.tags.join(", ")}]`
    )
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
