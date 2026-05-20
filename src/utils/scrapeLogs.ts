import { Client, Message, TextChannel } from "discord.js";
// CommonJS interop — the web/ libs are plain .js and live alongside the bot
// in the same container.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LOG_CHANNELS, LOG_CHANNEL_IDS } = require("../../web/lib/logChannels");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseMessage } = require("../../web/lib/logParsers");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logStore = require("../../web/lib/logStore");

type ChannelMapping = { type: string; region: string; server: string | null };

const BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_BATCH = 100;
const FETCH_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function ingestMessage(message: Message, mapping: ChannelMapping): Promise<number> {
	try {
		const rows = parseMessage(message, mapping);
		if (!rows.length) return 0;
		return logStore.ingestParsed(message.channelId, message.id, rows);
	} catch (err) {
		console.error(`[scrapeLogs] parse failed for msg ${message.id}:`, err);
		return 0;
	}
}

async function backfillChannel(client: Client, channelId: string, mapping: ChannelMapping): Promise<void> {
	let channel: TextChannel;
	try {
		const fetched = await client.channels.fetch(channelId);
		if (!fetched || !fetched.isTextBased()) {
			console.warn(`[scrapeLogs] channel ${channelId} not text/found`);
			return;
		}
		channel = fetched as TextChannel;
	} catch (err) {
		console.warn(`[scrapeLogs] cannot fetch channel ${channelId}:`, (err as Error).message);
		return;
	}

	const since = Date.now() - BACKFILL_MS;
	let before: string | undefined;
	let totalMessages = 0;
	let totalRows = 0;
	let pages = 0;

	while (true) {
		let batch: Message[];
		try {
			const fetched = await channel.messages.fetch({ limit: FETCH_BATCH, before });
			batch = Array.from(fetched.values());
		} catch (err) {
			console.warn(`[scrapeLogs] fetch failed for ${channelId}:`, (err as Error).message);
			break;
		}
		if (!batch.length) break;
		pages++;

		let hitFloor = false;
		for (const msg of batch) {
			if (msg.createdTimestamp < since) { hitFloor = true; continue; }
			totalMessages++;
			totalRows += await ingestMessage(msg, mapping);
		}
		// Page anchor = oldest message in this batch.
		before = batch[batch.length - 1].id;
		if (hitFloor || batch.length < FETCH_BATCH) break;
		await sleep(FETCH_DELAY_MS);
	}

	console.log(`[scrapeLogs] ${mapping.type}${mapping.server ? ` (${mapping.server})` : mapping.region ? ` (${mapping.region})` : ""} — ${pages} pages, ${totalMessages} messages, ${totalRows} rows from ${channelId}`);
}

export async function backfillAllLogs(client: Client): Promise<void> {
	console.log(`[scrapeLogs] backfill starting — ${LOG_CHANNEL_IDS.length} channels, last 30d`);
	const start = Date.now();
	// Run sequentially per channel to stay friendly to Discord rate limits.
	for (const id of LOG_CHANNEL_IDS) {
		await backfillChannel(client, id, LOG_CHANNELS[id]);
	}
	console.log(`[scrapeLogs] backfill done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

export function isLogChannel(channelId: string): boolean {
	return channelId in LOG_CHANNELS;
}

export async function handleLiveLogMessage(message: Message): Promise<void> {
	const mapping = LOG_CHANNELS[message.channelId];
	if (!mapping) return;
	await ingestMessage(message, mapping);
}
