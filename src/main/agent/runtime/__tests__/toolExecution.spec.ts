import { describe, expect, it } from 'vitest'
import { buildToolObservation } from '../toolExecution'

describe('toolExecution', () => {
  it('injects list_dir item names into the model observation', () => {
    const output = {
      path: '/workspace',
      offset: 0,
      limit: 2,
      total: 2,
      hasMore: false,
      items: [
        { name: 'package.json', type: 'file' },
        { name: 'src', type: 'directory' },
      ],
    }

    const observation = buildToolObservation('list_dir', { output }, JSON.stringify(output))

    expect(observation).toContain('returned=2')
    expect(observation).toContain('package.json')
    expect(observation).toContain('src')
  })
})
