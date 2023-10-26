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
  if (
    message.author.id != process.env.bjj_user_id ||
    message.content.startsWith('!') ||
    message.author.bot
  ) {
    return
  }

  if (message.content === '/clear' && message.channel.name === 'ask-gpt-4') {
    message.channel.threads.cache.forEach((thread) => {
      thread.delete()
      return
    })
  }

  if (message.channel.name === 'ask-gpt-4' && !message.channel.isThread()) {
    const title = await GenerateTitle(message)

    let thread = await message.startThread({
      name: title,
      autoArchiveDuration: 10080,
      reason: 'Needed a separate thread for food',
    })

    let conversation = [
      {
        role: 'system',
        content: '',
      },
    ]
  }
})

async function GenerateTitle(message) {
  let createTitle = [
    {
      role: 'system',
      content:
        'You are a header generator chatbot. You summerise text sent by the user into a concise, simple, and neutral half sentence to be used as a topic header for the message. The header is always less than 35 characters. The header is general, not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.',
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
