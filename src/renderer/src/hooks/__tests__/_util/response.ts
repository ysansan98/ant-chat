export function createChatCompletionsResponse(data: string[]) {
  const sseDataChunks = data.map((item, index) =>
    `data: ${JSON.stringify(createChunk(item, index))}\n\n`,
  )
  const sseChunks: string[] = [
    'event: message\n',
    ...sseDataChunks,
    'data: [DONE]\n\n',
  ]

  const readableStream = new ReadableStream({
    async start(controller) {
      for (const chunk of sseChunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    },
  })

  return new Response(readableStream)
}

function createChunk(data: string, index: number) {
  return { id: index, choices: [{ index: 0, delta: { role: 'assistant', content: data }, logprobs: null, finish_reason: null }], created: 1737164986, model: 'gemini-1.5-pro-latest', object: 'chat.completion.chunk' }
}
