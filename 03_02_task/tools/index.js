import { toolExecuteCommand } from "./shell.js";
import { toolSubmitAnswer } from "./verify.js";

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "execute_command",
      description:
        "Execute a shell command inside the remote virtual machine via the hub /api/shell endpoint. " +
        "The VM runs a limited Linux distribution with a NON-STANDARD command set. " +
        "ALWAYS start with the 'help' command to see which commands are available — " +
        "do NOT assume standard Linux commands work. " +
        "The firmware volume (/opt/firmware) allows writes; the rest of the disk is read-only. " +
        "BANNED paths (never access): /etc, /root, /proc/ and any path listed in .gitignore files. " +
        "Violations cause a timed API ban and VM reset.",
      parameters: {
        type: "object",
        required: ["cmd"],
        properties: {
          cmd: { type: "string", description: "The shell command to run on the VM." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description:
        "Submit the ECCS code obtained from running the firmware binary to the hub /verify endpoint. " +
        "The code format is: ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx " +
        "(ECCS- prefix followed by 40 hex characters). " +
        "Call this ONLY once you have extracted the exact ECCS code from the binary output.",
      parameters: {
        type: "object",
        required: ["confirmation"],
        properties: {
          confirmation: {
            type: "string",
            description: "The full ECCS code string, e.g. ECCS-abc123...",
          },
        },
      },
    },
  },
];

export async function dispatchTool(name, args) {
  switch (name) {
    case "execute_command": return toolExecuteCommand(args.cmd);
    case "submit_answer":   return toolSubmitAnswer(args.confirmation);
    default:                return { error: `Unknown tool: ${name}` };
  }
}
