// A Discord bot that expands X links into clean embeds and unrolls threads on request.
import { AttachmentBuilder, Client, EmbedBuilder, Events, GatewayIntentBits } from 'discord.js';
import { Xcrap, XcrapConnectionError, XcrapNotFound, XcrapOptedOut, XcrapRateLimited } from '@xcrapcc/sdk';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Set DISCORD_TOKEN to your bot token first (see .env.example).');
  process.exit(1);
}

const STATUS_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w{1,15}\/status\/\d+/gi;
const MAX_LINKS_PER_MESSAGE = 3;

const xcrap = new Xcrap();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const number = (value) => (value == null ? 'n/a' : value.toLocaleString('en-US'));

/** Turn an SDK error into a short, friendly sentence for the channel. */
function explain(error) {
  if (error instanceof XcrapNotFound) return 'That post is deleted, private, or never existed.';
  if (error instanceof XcrapOptedOut) return 'This account asked not to be shown through XCrap.';
  if (error instanceof XcrapRateLimited) return `I am reading a lot of posts right now. Try again in ${error.retryAfter}s.`;
  if (error instanceof XcrapConnectionError) return 'I could not reach XCrap just now. Please try again soon.';
  return 'Something went wrong while reading that post. Please try again in a minute.';
}

function buildEmbed(tweet) {
  const author = tweet.author ?? {};
  const embed = new EmbedBuilder()
    .setColor(0x1d9bf0)
    .setURL(tweet.url)
    .setAuthor({ name: `${author.name ?? 'Unknown'} (@${author.screen_name ?? '?'})`, iconURL: author.avatar_url ?? undefined, url: author.url ?? undefined })
    .setDescription(tweet.text.slice(0, 4000) || '*(no text)*')
    .addFields(
      { name: 'Likes', value: number(tweet.metrics.likes), inline: true },
      { name: 'Reposts', value: number(tweet.metrics.retweets), inline: true },
      { name: 'Replies', value: number(tweet.metrics.replies), inline: true },
    )
    .setFooter({ text: 'via xcrap.cc' });
  if (tweet.created_timestamp) embed.setTimestamp(tweet.created_timestamp * 1000);
  const image = tweet.media.find((item) => item.type === 'photo')?.url ?? tweet.media[0]?.thumbnail_url;
  if (image) embed.setImage(image);
  return embed;
}

async function sendThread(message, url) {
  if (!url || !url.match(STATUS_LINK)) {
    await message.reply('Usage: `!thread <x.com status link>`');
    return;
  }
  await message.channel.sendTyping();
  try {
    const markdown = await xcrap.thread(url, { markdown: true, maxTweets: 100 });
    const id = url.match(/status\/(\d+)/)[1];
    const file = new AttachmentBuilder(Buffer.from(markdown, 'utf8'), { name: `thread-${id}.md` });
    await message.reply({ content: 'Here is the whole thread:', files: [file] });
  } catch (error) {
    await message.reply(explain(error));
  }
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!thread')) {
    await sendThread(message, message.content.split(/\s+/)[1]);
    return;
  }

  const links = [...new Set(message.content.match(STATUS_LINK) ?? [])].slice(0, MAX_LINKS_PER_MESSAGE);
  for (const link of links) {
    try {
      const tweet = await xcrap.tweet(link);
      await message.reply({ embeds: [buildEmbed(tweet)], allowedMentions: { repliedUser: false } });
    } catch (error) {
      await message.reply({ content: explain(error), allowedMentions: { repliedUser: false } });
    }
  }
});

client.once(Events.ClientReady, (ready) => console.log(`Logged in as ${ready.user.tag}`));
client.login(token);
