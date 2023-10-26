import dotenv from 'dotenv'
import { Client, GatewayIntentBits, IntentsBitField } from 'discord.js'
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
  const gpt4Prompt =
    'As a Discord chatbot, your primary goal is to provide clear and concise responses.'
  const model = 'gpt-4'
  const gpt4Channel = 'ask-gpt-4'

  if (
    message.author.id != process.env.bjj_user_id ||
    message.content.startsWith('!') ||
    message.author.bot
  ) {
    return
  }

  if (message.content === '/clear' && message.channel.name === gpt4Channel) {
    message.channel.threads.cache.forEach((thread) => {
      thread.delete()
    })
    return
  }

  if (message.channel.name === gpt4Channel && !message.channel.isThread()) {
    const title = await GenerateTitle(message)

    let thread = await message.startThread({
      name: title,
      autoArchiveDuration: 10080,
      reason: 'Needed a separate thread for food',
    })

    threads.push({ id: thread.id, conversation: [] })

    threads[threads.length - 1].conversation.push({
      role: 'system',
      content: gpt4Prompt,
    })

    threads[threads.length - 1].conversation.push({
      role: 'user',
      content: message.content,
    })

    thread.sendTyping()

    const result = await openai.chat.completions.create({
      messages: threads[threads.length - 1].conversation,
      model: model,
    })

    threads[threads.length - 1].conversation.push({
      role: 'system',
      content: result.choices[0].message.content,
    })

    splitLongMessages(result.choices[0].message.content).forEach(
      (messageContent) => {
        thread.send(messageContent)
      }
    )
  }

  if (
    message.channel.isThread() &&
    message.channel.parent.name === gpt4Channel
  ) {
    const thread = threads.find((thread) => thread.id === message.channel.id)

    thread.conversation.push({
      role: 'user',
      content: message.content,
    })

    message.channel.sendTyping()

    const result = await openai.chat.completions.create({
      messages: threads.find((thread) => thread.id === message.channel.id)
        .conversation,
      model: model,
    })

    thread.conversation.push({
      role: 'system',
      content: result.choices[0].message.content,
    })

    splitLongMessages(result.choices[0].message.content).forEach(
      (messageContent) => {
        console.log()
        message.channel.send(messageContent)
      }
    )
  }
})

async function GenerateTitle(message) {
  const headerPrompt =
    'You are a header generator chatbot. You summerise text sent by the user into a concise, simple, and neutral half sentence to be used as a topic header for the message. The header is always less than 35 characters. The header is general, not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.'

  let createTitle = [
    {
      role: 'system',
      content: headerPrompt,
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

function splitLongMessages(messageContent) {
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
