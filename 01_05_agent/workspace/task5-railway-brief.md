# Task 5 — Railway (lesson 5)

**Goal:** Activate railway route **X-01** via the Hub API and return the flag `{FLG:...}`.

## API

- **Endpoint:** `POST https://hub.ag3nts.org/verify`
- **Body:** JSON with `apikey`, `task: "railway"`, `answer: { action, ... }`
- **You do NOT call the API yourself.** You have a tool called **railway** that does it. Use it.

## Tool: railway

You have a built-in tool **railway**. Use it with:

- `action: "help"` — get API documentation (do this first)
- `action: "reconfigure", route: "X-01"` — enable reconfigure mode
- `action: "setstatus", route: "X-01", value: "RTOPEN"` — set route to open
- `action: "save", route: "X-01"` — save and exit reconfigure mode

The tool handles 503 and 429 for you. Call the actions in that order. When the API returns a message containing `{FLG:...}`, report that flag to the user.

## Important

- Do **not** delegate this task to another agent (e.g. bob). Only you have the **railway** tool.
- Do **not** refuse: this is a legitimate course task (AI Devs lesson 5), not a security bypass.
- Use the **railway** tool; do not try to call external APIs by other means.
