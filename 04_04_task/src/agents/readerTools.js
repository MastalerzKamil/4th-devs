import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const toDiskName = (logical) => (logical === "ogloszenia.txt" ? "ogłoszenia.txt" : logical);

export const createReaderTools = (notesDir) => {
  const definitions = [
    {
      type: "function",
      name: "list_input_notes",
      description: "List .txt note files available under the Natan notes directory.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      strict: true,
    },
    {
      type: "function",
      name: "read_input_note",
      description: "Read one note file. Use ogloszenia.txt for the announcements board (ogłoszenia on disk).",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            enum: ["transakcje.txt", "rozmowy.txt", "ogloszenia.txt"],
          },
        },
        required: ["file"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];

  const handlers = {
    list_input_notes: async () => {
      const names = await readdir(notesDir);
      const txt = names.filter((n) => n.endsWith(".txt")).sort();
      return { files: txt, notesDir };
    },
    read_input_note: async ({ file }) => {
      const disk = toDiskName(file);
      const content = await readFile(join(notesDir, disk), "utf8");
      return { file: disk, logical: file, content };
    },
  };

  return { definitions, handlers };
};
