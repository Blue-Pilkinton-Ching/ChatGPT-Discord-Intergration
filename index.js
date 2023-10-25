import dotenv from 'dotenv'
dotenv.config()

const { token } = process.env
import { Client, GatewayIntentBits, IntentsBitField } from 'discord.js'

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
})

client.on('ready', () => {
  console.log('the bot is online!')
})

client.on('messageCreate', (message) => {
  message.reply(message.content)
})

client.login(process.env.token)
