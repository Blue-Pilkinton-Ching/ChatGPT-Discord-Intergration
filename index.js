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
    message.content.startsWith('!')
  ) {
    return
  }

  //console.log(message)

  if (message.channel.name === 'ask-gpt-4' && !message.channel.isThread()) {
    const title = await GenerateTitle(message)

    let thread = await message.startThread({
      name: title,
      autoArchiveDuration: 10080,
      reason: 'Needed a separate thread for food',
    })
  }
})

async function GenerateTitle(message) {
  let createTitle = [
    {
      role: 'system',
      content:
        'You are a title generator chatbot. You summerise text sent by the user into a short, simple, and neutral half sentence to be used as a header for a chat. The header is always less than 30 characters. The header should be general, and not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.',
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
