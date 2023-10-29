import dotenv from 'dotenv'
import { Client, IntentsBitField } from 'discord.js'
import OpenAI from 'openai'

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
  apiKey: process.env.open_ai_token, // This is also the default, can be omitted
})

const threads = []

client.on('messageCreate', async (message) => {
  const settings = {
    headerPrompt:
      'You are a header generator chatbot. You summerise text sent by the user into a concise, simple, and neutral half sentence to be used as a topic header for the message. The header is always less than 35 characters. The header is general, not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.',
    gpt4Prompt:
      'You are a discord chatbot. You provide clear and concise responses, to user questions and queries.',
    model: 'gpt-3.5-turbo',
    // model: 'gpt-4',
    gpt4Channel: 'ask-gpt-4',
    currency: 'NZD',
    gpt4inputCostPer1k: 0.03,
    gpt4outputCostPer1k: 0.06,
    gpt3inputCostPer1k: 0.0015,
    gpt3outputCostPer1k: 0.002,
    decimalCount: 3,
  }

  if (
    message.author.id != process.env.bjj_user_id ||
    message.content.startsWith('!') ||
    message.author.bot
  ) {
    return
  }

  if (
    message.content === '/clear' &&
    message.channel.name === settings.gpt4Channel
  ) {
    message.channel.threads.cache.forEach((thread) => {
      thread.delete()
    })
    return
  }

  // THREAD STARTING
  if (
    message.channel.name === settings.gpt4Channel &&
    !message.channel.isThread()
  ) {
    const title = await GenerateTitle(message)

    let newThread = await message.startThread({
      name: title,
      autoArchiveDuration: 10080,
    })

    threads.push({
      id: newThread.id,
      conversation: [],
      totalCost: 0,
      totalTokens: 0,
    })

    const thread = threads[threads.length - 1]

    AddMessageToConversation(thread, 'system', settings.gpt4Prompt)
    AddMessageToConversation(thread, 'user', message.content)

    await SendAIResponse(newThread, thread)
  }

  // THREAD CONVERSATION
  if (
    message.channel.isThread() &&
    message.channel.parent.name === settings.gpt4Channel
  ) {
    const thread =
      threads[threads.findIndex((thread) => thread.id === message.channel.id)]

    AddMessageToConversation(thread, 'user', message.content)
    SendAIResponse(message.channel, thread)
  }

  // AI RESPONSE

  async function SendAIResponse(channel, thread) {
    channel.sendTyping()

    const completion = await openai.chat.completions.create({
      messages: thread.conversation,
      model: settings.model,
    })

    SplitLongMessages(completion.choices[0].message.content).forEach(
      (messageContent) => {
        channel.send(messageContent)
      }
    )

    AddMessageToConversation(
      thread,
      'assistant',
      completion.choices[0].message.content
    )

    // Calculate stats

    const usdCost =
      usage.prompt_tokens *
        (0.001 *
          (settings.model === 'gpt4'
            ? settings.gpt4inputCostPer1k
            : settings.gpt3inputCostPer1k)) +
      usage.completion_tokens *
        0.001 *
        (settings.model === 'gpt4'
          ? settings.gpt4outputCostPer1k
          : settings.gpt3outputCostPer1k)

    const fetchLink = `https://v6.exchangerate-api.com/v6/${process.env.exchange_rate_key}/pair/USD/${settings.currency}`
    const response = await fetch(fetchLink)
    const json = await response.json()

    thread.totalCost = thread.totalCost + json.conversion_rate * usdCost
    thread.totalTokens = usage.total_tokens

    // Send stats

    channel.send(
      `***${settings.model} | ${thread.totalTokens} tokens | ${(
        thread.totalCost * 100
      ).toFixed(settings.decimalCount)}¢ ${settings.currency}***`
    )
  }

  // HELPER FUNCTIONS

  function AddMessageToConversation(thread, role, completion) {
    thread.conversation.push({
      role: role,
      content: completion,
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
      model: 'gpt-3.5-turbo',
    })

    return result.choices[0].message.content
  }

  function SplitLongMessages(messageContent) {
    const discordCharactorLimit = 2000

    let response = []

    if (messageContent.length < discordCharactorLimit) {
      response.push(messageContent)
      return response
    } else {
      const sections = Math.ceil(messageContent.length / discordCharactorLimit)

      for (let i = 0; i < sections; i++) {
        response.push(
          messageContent.substring(
            i * discordCharactorLimit,
            i === sections - 1
              ? messageContent.length
              : (i + 1) * discordCharactorLimit
          )
        )
      }
      return response
    }
  }
})
