import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SENSORS_DIR } from '../config.js'
import type { SensorData, SensorReadout } from '../types.js'

// ============================================================================
// read_sensor_readouts — tool used by task agents
// ============================================================================

export const readSensorReadout = async (fileId: string): Promise<SensorReadout> => {
  const filename = fileId.endsWith('.json') ? fileId : `${fileId}.json`
  const filePath = join(SENSORS_DIR, filename)
  const content = await readFile(filePath, 'utf8')
  const data = JSON.parse(content) as SensorData
  const id = filename.replace('.json', '')
  return { fileId: id, data }
}

export const listAllSensorIds = async (): Promise<string[]> => {
  const entries = await readdir(SENSORS_DIR)
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort()
}

export const readSensorBatch = async (fileIds: string[]): Promise<SensorReadout[]> => {
  return Promise.all(fileIds.map(readSensorReadout))
}

// Tool definition for LLM agents
export const READ_SENSOR_READOUTS_TOOL = {
  type: 'function' as const,
  name: 'read_sensor_readouts',
  description: 'Read sensor data from one or more sensor files by their IDs. Returns the raw sensor readings including all field values and operator notes.',
  parameters: {
    type: 'object',
    properties: {
      file_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of sensor file IDs to read (e.g. ["0001", "0002"] or ["0001.json"])',
      },
    },
    required: ['file_ids'],
    additionalProperties: false,
  },
}

export const executeSensorReadTool = async (argsJson: string): Promise<string> => {
  const args = JSON.parse(argsJson) as { file_ids: string[] }
  const results = await readSensorBatch(args.file_ids)
  return JSON.stringify(results, null, 2)
}
