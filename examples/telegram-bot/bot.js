// A Telegram bot that reads X posts and threads for you.
import { Bot, InputFile } from 'grammy';
import { Xcrap, XcrapConnectionError, XcrapNotFound, XcrapOptedOut, XcrapRateLimited } from '@xcrapcc/sdk';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN to the token BotFather gave you (see .env.example).');
  process.exit(1);
}

const STATUS_LINK = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w{1,15}\/status\/\d+/gi;
const xcrap = new Xcrap();
const bot = new Bot(token);

const number = (value) => (value == null ? 'n/a' : value.toLocaleString('en-US'));

function explain(error) {
  if (error instanceof XcrapNotFound) return 'That post is deleted, private, or never existed.';
  if (error instanceof XcrapOptedOut) return 'This account asked not to be shown through XCrap.';
  if (error instanceof XcrapRateLimited) return `Lots of requests right now. Please try again in ${error.retryAfter}s.`;
  if (error instanceof XcrapConnectionError) return 'Could not reach XCrap just now. Please try again soon.';
  return 'Something went wrong while reading that post. Please try again in a minute.';
}

/** Plain text (no parse mode), so nothing in a post can break the formatting. */
function describe(tweet) {
  const author = tweet.author ?? {};
  const { likes, retweets, replies, views } = tweet.metrics;
  const lines = [
    `${author.name ?? 'Unknown'} (@${author.screen_name ?? '?'})`,
    '',
    tweet.text || '(no text)',
    '',
    `${number(likes)} likes · ${number(retweets)} reposts · ${number(replies)} replies${views ? ` · ${number(views)} views` : ''}`,
  ];
  if (tweet.media.length) lines.push(`${tweet.media.length} attachment(s): ${tweet.media[0].url}`);
  lines.push(tweet.url);
  return lines.join('\n').slice(0, 4096);
}

async function replyWithTweet(ctx, url) {
  try {
    const tweet = await xcrap.tweet(url);
    await ctx.reply(describe(tweet), { link_preview_options: { is_disabled: true } });
  } catch (error) {
    await ctx.reply(explain(error));
  }
}

bot.command('start', (ctx) =>
  ctx.reply('Send me an X link, or use /tweet <url> and /thread <url>.'),
);

bot.command('tweet', async (ctx) => {
  const url = ctx.match.trim();
  if (!url) return ctx.reply('Usage: /tweet https://x.com/user/status/123');
  return replyWithTweet(ctx, url);
});

bot.command('thread', async (ctx) => {
  const url = ctx.match.trim();
  if (!url) return ctx.reply('Usage: /thread https://x.com/user/status/123');
  try {
    await ctx.replyWithChatAction('upload_document');
    const markdown = await xcrap.thread(url, { markdown: true, maxTweets: 100 });
    const id = url.match(/status\/(\d+)/)?.[1] ?? 'thread';
    const file = new InputFile(Buffer.from(markdown, 'utf8'), `thread-${id}.md`);
    return ctx.replyWithDocument(file, { caption: 'Here is the whole thread.' });
  } catch (error) {
    return ctx.reply(explain(error));
  }
});

// Plain links in any message get expanded automatically (commands are handled above).
bot.on('message:text', async (ctx) => {
  const links = [...new Set(ctx.message.text.match(STATUS_LINK) ?? [])].slice(0, 3);
  for (const link of links) await replyWithTweet(ctx, link);
});

bot.catch((err) => console.error('Bot error:', err.error));
bot.start({ onStart: (me) => console.log(`Running as @${me.username}`) });
