import { OPENROUTER_BASE, OPENROUTER_KEY, MODEL, MAX_ITERATIONS, HUB_BASE, TASK } from "./config.js";
import { TOOLS, dispatchTool } from "./tools/index.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { sleep, extractEccsCode, extractFlag } from "./utils.js";

export async function runAgent() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   S03E02 — Firmware Recovery Agent       ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log(`Model    : ${MODEL}`);
  console.log(`Hub      : ${HUB_BASE}`);
  console.log(`Task     : ${TASK}`);
  console.log(`Shell API: ${HUB_BASE}/api/shell\n`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Begin the firmware recovery mission. " +
        "Start by running 'help' to learn the available commands, then systematically " +
        "explore the VM, find the password, configure settings.ini, run the firmware binary, " +
        "extract the ECCS code, and submit it.",
    },
  ];

  let iteration = 0;
  let missionComplete = false;

  while (iteration < MAX_ITERATIONS && !missionComplete) {
    iteration++;
    console.log(`\n${"─".repeat(55)}`);
    console.log(`Iteration ${iteration}/${MAX_ITERATIONS}`);
    console.log("─".repeat(55));

    // Call the LLM
    let llmRes;
    try {
      llmRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_KEY}`,
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages, tools: TOOLS, tool_choice: "auto" }),
      });
    } catch (err) {
      console.error(`[LLM] Network error: ${err.message} — waiting 10s`);
      await sleep(10000);
      iteration--;
      continue;
    }

    if (!llmRes.ok) {
      const errBody = await llmRes.text().catch(() => "");
      if (llmRes.status === 429) {
        console.log(`[LLM] Rate limited, waiting 15s...`);
        await sleep(15000);
        iteration--;
        continue;
      }
      throw new Error(`OpenRouter error ${llmRes.status}: ${errBody.slice(0, 400)}`);
    }

    const llmData = await llmRes.json();
    const choice = llmData.choices?.[0];
    if (!choice) {
      console.error("[LLM] No choices in response:", JSON.stringify(llmData).slice(0, 300));
      break;
    }

    const msg = choice.message;
    const assistantMsg = { role: "assistant", content: msg.content ?? "" };
    if (msg.tool_calls?.length) assistantMsg.tool_calls = msg.tool_calls;
    messages.push(assistantMsg);

    if (msg.content?.trim()) {
      console.log(`\n[Agent]\n${msg.content.trim()}\n`);
    }

    if (!msg.tool_calls?.length) {
      console.log(`\n✅ Agent finished (stop reason: ${choice.finish_reason})`);
      missionComplete = true;
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const call of msg.tool_calls) {
      const toolName = call.function.name;
      let args;
      try { args = JSON.parse(call.function.arguments || "{}"); }
      catch { args = {}; }

      console.log(`\n[Tool Call] ${toolName}(${JSON.stringify(args)})`);

      let result;
      try { result = await dispatchTool(toolName, args); }
      catch (err) { result = { error: err.message }; }

      const resultStr = JSON.stringify(result);
      console.log(`[Tool Result] ${resultStr.slice(0, 500)}`);
      if (resultStr.length > 500) console.log(`  ... (${resultStr.length} chars total)`);

      const eccs = extractEccsCode(resultStr);
      if (eccs) console.log(`\n🎯 ECCS code detected: ${eccs}`);

      const flag = extractFlag(resultStr);
      if (flag) {
        console.log(`\n🏁 FLAG FOUND: ${flag}`);
        missionComplete = true;
      }

      if (toolName === "submit_answer" && result?.code === 0) {
        console.log(`\n🎉 SUCCESS! Answer accepted by hub!`);
        if (result.flag || result.message) console.log(`   ${result.flag ?? result.message}`);
        missionComplete = true;
      }

      toolResults.push({ role: "tool", tool_call_id: call.id, content: resultStr });
    }

    messages.push(...toolResults);
  }

  if (iteration >= MAX_ITERATIONS && !missionComplete) {
    console.log(`\n⚠️  Reached maximum iterations (${MAX_ITERATIONS}) without completing.`);
  }

  console.log("\n══ Agent loop ended ══");
}
