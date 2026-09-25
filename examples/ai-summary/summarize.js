// Fetch a thread as Markdown and wrap it in a ready-to-send LLM prompt.
import { Xcrap, XcrapConnectionError, XcrapNotFound, XcrapOptedOut, XcrapRateLimited } from '@xcrapcc/sdk';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node summarize.js <x.com status link>');
  process.exit(2);
}

const xcrap = new Xcrap();

function buildPrompt(threadMarkdown) {
  return [
    'You are a careful editor. Summarise the X thread below for someone who has not read it.',
    'Give: a one-sentence summary, 3 to 5 key points as bullets, and any links or numbers worth keeping.',
    'Only use what is in the thread. Quote the author when wording matters.',
    '',
    '<thread>',
    threadMarkdown.trim(),
    '</thread>',
  ].join('\n');
}

let markdown;
try {
  markdown = await xcrap.thread(url, { markdown: true, maxTweets: 100 });
} catch (error) {
  if (error instanceof XcrapNotFound) console.error('That post is deleted, private, or never existed.');
  else if (error instanceof XcrapOptedOut) console.error('This account opted out of XCrap.');
  else if (error instanceof XcrapRateLimited) console.error(`Rate limited. Try again in ${error.retryAfter} seconds.`);
  else if (error instanceof XcrapConnectionError) console.error('Could not reach XCrap. Check your connection.');
  else console.error(`Could not fetch the thread: ${error.message}`);
  process.exit(1);
}

const prompt = buildPrompt(markdown);
const tokens = xcrap.lastMeta?.markdownTokens;
console.error(`Prompt ready${tokens ? ` (thread is about ${tokens} tokens)` : ''}.\n`);
console.log(prompt);

// ── Send it to a model ──────────────────────────────────────────────────────
// Uncomment ONE of the blocks below. Keys come from environment variables only.
//
// OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, ...):
//
// const res = await fetch(`${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
//   method: 'POST',
//   headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
//   body: JSON.stringify({ model: process.env.AI_MODEL, messages: [{ role: 'user', content: prompt }] }),
// });
// const data = await res.json();
// console.log('\n--- Summary ---\n' + data.choices[0].message.content);
//
// Anthropic Messages API:
//
// const res = await fetch('https://api.anthropic.com/v1/messages', {
//   method: 'POST',
//   headers: {
//     'content-type': 'application/json',
//     'x-api-key': process.env.ANTHROPIC_API_KEY,
//     'anthropic-version': '2023-06-01',
//   },
//   body: JSON.stringify({ model: process.env.AI_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
// });
// const data = await res.json();
// console.log('\n--- Summary ---\n' + data.content[0].text);
