import dotenv from 'dotenv'
import { Client, IntentsBitField, channelLink } from 'discord.js'
import OpenAI from 'openai'
import { getEncoding } from 'js-tiktoken'

dotenv.config()

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.MessageContent,
  ],
})

client.login(process.env.discord_bot_token)

client.on('ready', () => {
  console.log('ChatGPT Intergration discord bot is online!')
})

const openai = new OpenAI({
  apiKey: process.env.open_ai_token,
})

const threads = []
let nextModel = 'gpt-4-1106-preview'

const settings = {
  headerPrompt:
    'You are a header generator chatbot. You summerise text sent by the user into a concise, simple, and neutral half sentence to be used as a topic header for the message. The header is always less than 35 characters. The header is general, not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.',
  assistantPrompt:
    'You are an assistant discord chatbot. You provide clear and concise responses, to the users questions and queries.',
  gptChannel: 'ask-gpt',
  currency: 'NZD',
  gpt4inputCostPer1k: 0.01,
  gpt4outputCostPer1k: 0.03,
  gpt3inputCostPer1k: 0.001,
  gpt3outputCostPer1k: 0.002,
  decimalCount: 3,
}

client.on('messageCreate', async (message) => {
  if (
    message.author.id != process.env.bjj_user_id ||
    message.content.startsWith('!') ||
    message.author.bot
  ) {
    return
  }

  if (
    message.channel.name === settings.gptChannel &&
    message.content.startsWith('/')
  ) {
    if (message.content === '/clear') {
      message.channel.threads.cache.forEach((thread) => {
        thread.delete()
      })
    } else if (message.content === '/gpt3') {
      nextModel = 'gpt-3.5-turbo-1106'
      message.channel.send('***Set model to GPT-3***')
    } else if (message.content === '/gpt4') {
      nextModel = 'gpt-4-1106-preview'
      message.channel.send('***Set model to GPT-4***')
    }
    return
  }

  // THREAD STARTING
  if (
    message.channel.name === settings.gptChannel &&
    !message.channel.isThread()
  ) {
    let newThread = await message.startThread({
      name: 'Loading...',
      autoArchiveDuration: 10080,
    })

    console.log('Received Message: ' + message.content)

    GenerateTitle(message).then((result) => newThread.setName(result))

    threads.push({
      id: newThread.id,
      conversation: [],
      totalCost: 0,
      totalTokens: 0,
      model: nextModel,
    })

    nextModel = 'gpt-4-1106-preview'

    const thread = threads[threads.length - 1]

    AddMessageToConversation(thread, 'system', settings.assistantPrompt)
    AddMessageToConversation(thread, 'user', message.content)

    await SendAIResponse(newThread, thread, true)
  }

  // THREAD CONVERSATION
  if (
    message.channel.isThread() &&
    message.channel.parent.name === settings.gptChannel
  ) {
    const thread =
      threads[threads.findIndex((thread) => thread.id === message.channel.id)]

    AddMessageToConversation(thread, 'user', message.content)
    await SendAIResponse(message.channel, thread)
  }

  // AI RESPONSE

  async function SendAIResponse(channel, thread, firstMessage = false) {
    channel.sendTyping()

    const completion = await openai.chat.completions.create({
      messages: thread.conversation,
      model: thread.model,
      stream: true,
      temperature: 0.9,
    })

    let messageContent = ['']
    let messageSection = 0
    let editSection = 0
    let outputTokens = 0
    let messages = [await channel.send('Waiting for stream...')]
    let finishedMessage = false

    let startedEditing = false

    for await (const chunk of completion) {
      const chunkContent = chunk.choices[0].delta.content

      if (chunk.choices[0].finish_reason) {
        finishedMessage = true
        break
      }

      if (chunkContent) {
        outputTokens++

        if (
          messageContent[messageSection].length + chunkContent.length >=
          2000
        ) {
          messageSection += 1

          const newMessage = await channel.send('Waiting for stream...')

          messages[messageSection] = newMessage
          messageContent.push('')
        }

        messageContent[messageSection] =
          messageContent[messageSection] + chunkContent

        if (!startedEditing) {
          startedEditing
          EditMessages()
        }
      }
    }

    // Calculate stats

    const usdCost =
      thread.totalTokens *
        (0.001 *
          (thread.model === 'gpt-4-1106-preview'
            ? settings.gpt4inputCostPer1k
            : settings.gpt3inputCostPer1k)) +
      outputTokens *
        0.001 *
        (thread.model === 'gpt-4-1106-preview'
          ? settings.gpt4outputCostPer1k
          : settings.gpt3outputCostPer1k)

    const fetchLink = `https://v6.exchangerate-api.com/v6/${process.env.exchange_rate_key}/pair/USD/${settings.currency}`
    const response = await fetch(fetchLink)
    const json = await response.json()

    thread.totalCost = thread.totalCost + json.conversion_rate * usdCost
    thread.totalTokens = thread.totalTokens + outputTokens

    // Send stats

    if (firstMessage) {
      const headerPromptTokens = getEncoding('cl100k_base').encode(
        settings.headerPrompt
      ).length
      const headerResponseTokens = getEncoding('cl100k_base').encode(
        channel.name
      ).length

      const inputCost = settings.gpt3inputCostPer1k * headerPromptTokens
      const outputCost = settings.gpt3outputCostPer1k * headerResponseTokens
      thread.totalCost +=
        json.conversion_rate * 0.001 * (inputCost + outputCost)
    }

    const out = `{thread.model} | ${thread.totalTokens} tokens | ${(
      thread.totalCost * 100
    ).toFixed(settings.decimalCount)}¢ ${settings.currency}`

    channel.send(`***${out}***`)
    console.log(`Response: ${out}`)

    AddMessageToConversation(thread, 'assistant', messageContent.join(''))

    function EditMessages() {
      startedEditing = true
      if (message.content === messageContent[editSection]) {
        if (messageSection != editSection) {
          editSection++
        }
        if (finishedMessage) {
          return
        }
      }

      messages[editSection].edit(messageContent[editSection]).then(() => {
        EditMessages()
      })
    }
  }

  // HELPER FUNCTIONS

  function AddMessageToConversation(thread, role, content) {
    thread.totalTokens += getEncoding('cl100k_base').encode(content).length
    thread.conversation.push({
      role: role,
      content: content,
    })
  }

  async function GenerateTitle(message) {
    let createTitle = [
      {
        role: 'system',
        content: settings.headerPrompt,
      },
    ]

    createTitle.push({
      role: 'user',
      content: message.content,
    })

    const result = await openai.chat.completions.create({
      messages: createTitle,
      model: 'gpt-3.5-turbo-1106',
      max_tokens: 10,
      temperature: 0,
    })

    return result.choices[0].message.content
  }
})
