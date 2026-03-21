import { openai, MODELS } from '../config.js'

export interface DamLocation {
  x: number
  y: number
  gridCols: number
  gridRows: number
  reasoning: string
}

export async function analyzeDroneMap(mapUrl: string): Promise<DamLocation> {
  console.log('[VisionAgent] Analyzing map image:', mapUrl)

  const response = await openai.chat.completions.create({
    model: MODELS.vision,
    messages: [
      {
        role: 'system',
        content: `You are a vision specialist analyzing a drone mission map.
The map is a grid of sectors. Your task:
1. Count the exact number of columns (x-axis, left to right) and rows (y-axis, top to bottom)
2. Identify the sector containing the DAM — it has intentionally enhanced/intensified blue water color
3. Return the dam sector position using 1-based indexing, starting from (1,1) at top-left

Respond with valid JSON only: {"x": <column>, "y": <row>, "gridCols": <total columns>, "gridRows": <total rows>, "reasoning": "<brief explanation>"}`
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: mapUrl },
          },
          {
            type: 'text',
            text: 'Analyze this grid map. Count columns and rows carefully. Find the dam sector (enhanced blue water color). Return JSON with x, y coordinates.',
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message.content ?? '{}'
  console.log('[VisionAgent] Analysis result:', content)

  const result = JSON.parse(content) as DamLocation
  console.log(`[VisionAgent] Dam at grid position: x=${result.x}, y=${result.y} (grid: ${result.gridCols}x${result.gridRows})`)
  return result
}
