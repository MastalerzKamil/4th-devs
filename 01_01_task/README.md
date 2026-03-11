# Task: Batch Tagging with Instructor JS

This app processes the `people.csv` file and applies **structured extraction** using [Instructor JS](https://js.useinstructor.com/) with Zod schemas for type-safe structured output.

## Overview

The app uses **Instructor JS** for structured extraction with Zod, which provides:
- Type-safe schema validation
- Direct integration with OpenAI API (via OpenRouter)
- Clean, declarative extraction schema
- Automatic retries and validation

## Filtering Criteria

The app filters for people matching ALL of the following:

1. **Gender**: Male (M)
2. **Age**: 20-40 years old (as of 2026)
3. **Birthplace**: Grudziądz
4. **Industry**: Transportation-related work

## Allowed Tags (Polish)

Each filtered person is tagged with one or more of these categories:

- `IT`
- `transport`
- `edukacja`
- `medycyna`
- `praca z ludźmi`
- `praca z pojazdami`
- `praca fizyczna`

### Tag Mapping

The AI generates detailed tags, which are then mapped to the allowed Polish list:

- **transport**: "logistics", "supply chain", "warehouse", "cargo", "freight", "transport", etc.
- **praca z pojazdami**: "driver", "truck", "bus", "vehicle", "pojazd", "kierowca"
- **praca fizyczna**: "manual", "physical", "fizycz"
- **edukacja**: "education", "teaching", "eduk"
- **medycyna**: "health", "medical", "doctor", "medycz"
- **praca z ludźmi**: "people", "customer", "client", "interpersonal", "ludź"
- **IT**: "software", "programming", "developer", "engineer", "algorithm", "code"
- **exact matches**: Tags that directly match allowed tags are preserved

## Output Format

The output file `output.json` contains:

```json
{
  "apikey": "sk-or-v1-...",
  "task": "people",
  "answer": [
    {
      "name": "Cezary",
      "surname": "Żurek",
      "gender": "M",
      "born": 1987,
      "city": "Grudziądz",
      "tags": ["transport"]
    },
    {
      "name": "Jacek",
      "surname": "Nowak",
      "gender": "M",
      "born": 1991,
      "city": "Grudziądz",
      "tags": ["transport"]
    }
  ]
}
```

### Field Descriptions

- **apikey**: Masked API key (first 20 chars + "...")
- **task**: Task identifier ("people")
- **answer**: Array of filtered and tagged people
  - **name**: First name
  - **surname**: Surname
  - **gender**: Gender (M/F)
  - **born**: Birth year as integer (e.g., 1987)
  - **city**: City of birth
  - **tags**: Array of Polish tag strings from allowed list

## Technology Stack

- **Instructor JS** - Structured extraction with Zod
- **Zod** - TypeScript-first schema validation
- **OpenAI API** (via OpenRouter) - LLM for extraction
- **Node.js ES modules** - Modern JavaScript runtime

## Setup

```bash
npm install
```

## Running the App

### Full run (all ~24k people)

```bash
npm run lesson1:task
# or
node ./01_01_task/app.js
```

### Test run (limit to N people)

```bash
MAX_PEOPLE=100 node ./01_01_task/app.js
```

## Files

- `app.js` - Main application with Instructor-based extraction
- `parseCsv.js` - CSV parser for `people.csv`
- `people.csv` - Input data with ~24,417 people
- `output.json` - Output with filtered and tagged results
- `package.json` - Node.js config with Instructor and Zod dependencies
- `README.md` - This file

## Why Instructor JS?

According to the [Instructor JS documentation](https://js.useinstructor.com/):

1. **Powered by OpenAI** — Uses OpenAI's function calling API for reliable structured output
2. **Type-safe** — Zod provides runtime schema validation and TypeScript type inference
3. **Simple API** — Clean, declarative extraction schema definition
4. **Ecosystem** — Zod is widely used and battle-tested (24M+ downloads/month)

## Current Results

- **Total people processed**: 24,417
- **People matching filter criteria**: 2
  - Cezary Żurek (born 1987, Grudziądz) → tags: `["transport"]`
  - Jacek Nowak (born 1991, Grudziądz) → tags: `["transport"]`
