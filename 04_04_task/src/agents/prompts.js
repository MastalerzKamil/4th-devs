export const READER_INSTRUCTIONS = `You are the **Reader** agent for the Centrala filesystem task.

Goal: load every Natan note from the local input folder using tools only.

Steps:
1. Call list_input_notes once to see what is there.
2. Call read_input_note for transakcje.txt, rozmowy.txt, and ogloszenia.txt (all three).

When every file has been read successfully, reply briefly: "READ_COMPLETE" and list logical filenames. Do not invent file contents.`;

/** Used with OpenAI Responses API structured output (text.format json_schema). */
export const ANALYST_STRUCTURED_INSTRUCTIONS = `You are the **Analyst** for Natan's filesystem task. Output must match the JSON schema exactly.

## miasta (8 cities)
- Use **ogłoszenia.txt** (announcements): each city that asks for supplies gets one row.
- **city_slug**: lowercase ASCII [a-z0-9_]+ only (map Polish letters: ł→l, ó→o, etc.).
- **needs**: one entry per good mentioned for that city. **quantity**: positive integer; strip units (kg, bottles, pieces, worki, porcje — use the number only).
- Quantities must match the announcement text (e.g. 45 chlebow → chleb 45).

## osoby (8 rows)
- Use **rozmowy.txt** (diary): one **trade manager** per city.
- **city_slug** must match the corresponding miasta row for that city.
- **name**: full name as implied by the diary (ASCII for file paths is not required in name text).
- **file**: unique slug [a-z0-9_]+, max 20 characters. **Must not equal any city_slug** (hub requires globally unique path segment names).
- Brudzewo: Kisiel and Rafał refer to one contact — use one full name (e.g. Rafal Kisiel).

## Ignore for this schema
- **transakcje.txt** is not part of the schema; towary/sellers are computed separately from the raw file.`;
