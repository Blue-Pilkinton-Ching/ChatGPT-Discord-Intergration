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
  apiKey: process.env.open_ai_token, // This is also the default, can be omitted
})

const threads = []

client.on('messageCreate', async (message) => {
  const settings = {
    headerPrompt:
      'You are a header generator chatbot. You summerise text sent by the user into a concise, simple, and neutral half sentence to be used as a topic header for the message. The header is always less than 35 characters. The header is general, not specific. The header should not be wrapped in any quotations. The header does not try to answer the question or text.',
    assistantPrompt:
      'You are an assistant discord chatbot. You provide clear and concise responses, to the users questions and queries.',
    modelChoicePrompt:
      'You are gpt-3. A highly advanced and intelligent AI GPT. You task is to evaluate how important and specific a question from the user is, and output a single number value between 0 and 1, where 0 is simple and 1 is complex. You should not answer the user.\nFactors that you should take in to account:\n- If the topic is specific, the value to should be closer to 1\n- If the topic is general knowlege related, the answer should be closer to 0\n- If the topic has little information about it on the internet, the value should be closer to 1\n- If the topic is a well known idea, it should be closer to 0\n- If the user explicity asks for gpt4 the value should be 1. \n- If the user explicity asks for gpt3 the value should be 0.',
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
    let newThread = await message.startThread({
      name: 'Loading...',
      autoArchiveDuration: 10080,
    })

    console.log('Received Message: ' + message.content)

    GenerateTitle(message).then((result) => newThread.setName(result))

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: settings.modelChoicePrompt },
        { role: 'user', content: message.content },
      ],
      temperature: 0,
      max_tokens: 3,
    })

    let model =
      parseFloat(completion.choices[0].message.content) > 0.5
        ? 'gpt-4'
        : 'gpt-3.5-turbo'

    threads.push({
      id: newThread.id,
      conversation: [],
      totalCost: 0,
      totalTokens: 0,
      model: model,
    })

    const thread = threads[threads.length - 1]

    AddMessageToConversation(thread, 'system', settings.assistantPrompt)
    AddMessageToConversation(thread, 'user', message.content)

    await SendAIResponse(newThread, thread, true)
  }

  // THREAD CONVERSATION
  if (
    message.channel.isThread() &&
    message.channel.parent.name === settings.gpt4Channel
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
          (thread.model === 'gpt4'
            ? settings.gpt4inputCostPer1k
            : settings.gpt3inputCostPer1k)) +
      outputTokens *
        0.001 *
        (thread.model === 'gpt4'
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
      const choiceProptTokens = getEncoding('cl100k_base').encode(
        settings.modelChoicePrompt
      ).length
      const choiceResponseTokens = 3

      const inputCost =
        settings.gpt3inputCostPer1k * (headerPromptTokens + choiceProptTokens)
      const outputCost =
        settings.gpt3outputCostPer1k *
        (choiceProptTokens + choiceResponseTokens)

      thread.totalCost +=
        json.conversion_rate * 0.001 * (inputCost + outputCost)
    }

    channel.send(
      `***${thread.model} | ${thread.totalTokens} tokens | ${(
        thread.totalCost * 100
      ).toFixed(settings.decimalCount)}¢ ${settings.currency}***`
    )

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
      model: 'gpt-3.5-turbo',
      max_tokens: 10,
      temperature: 0,
    })

    return result.choices[0].message.content
  }

  async function name(params) {}
})
