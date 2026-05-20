import { EmbedBuilder, Message } from "discord.js";
import { ExtendedClient } from "../structure";
import { isLogChannel, handleLiveLogMessage } from "../utils/scrapeLogs";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ticketBus = require("../../web/lib/ticketBus");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapMessage } = require("../../web/lib/ticketMessageShape");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSupportedCode, permKeyForCode } = require("../../web/lib/ticketCategories");

const DISALLOWED_MEDIA_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv|clips\.twitch\.tv|streamable\.com|vimeo\.com|dailymotion\.com|facebook\.com\/.*\/videos)/i;
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/i;
const MEDAL_REGEX = /(?:https?:\/\/)?(?:www\.)?medal\.tv\/[\w\/-]+/i;

export default class MessageCreateEvent {
	private readonly client: ExtendedClient;
	constructor(client: ExtendedClient) {
		this.client = client;
	}

	public async execute(message: Message): Promise<void> {
		// Game-log scraper runs BEFORE the bot/ticket filters because log
		// channels are fed by webhooks/apps (message.author.bot === true).
		if (isLogChannel(message.channelId)) {
			handleLiveLogMessage(message).catch((err) => console.error("[scrapeLogs] live ingest failed:", err));
			return;
		}

		if (!message.guild) return;

		// Check if this is a ticket channel. We do the prisma lookup BEFORE
		// the bot-author filter so admin-relay messages (sent by the bot
		// via the web POST endpoint) and bot system messages still flow to
		// the admin SPA over SSE — the only event source that wouldn't
		// already be covered by the POST handler's direct publish() call
		// is messages from native Discord users in the channel.
		const ticket = await this.client.prisma.tickets.findUnique({
			where: { channelid: message.channel.id }
		});
		if (ticket && !ticket.closedat) {
			try {
				const cat = JSON.parse(ticket.category) as { codeName?: string };
				if (cat?.codeName && isSupportedCode(cat.codeName)) {
					ticketBus.publish({
						type: "ticket.message",
						channelId: message.channelId,
						permKey: permKeyForCode(cat.codeName),
						payload: mapMessage(message, this.client.user?.id)
					});
				}
			} catch (err) {
				console.error("[ticketBus] publish failed in messageCreate:", err);
			}
		}

		if (message.author.bot) return;
		if (!ticket || ticket.closedat) return;

		// Check for disallowed media links (only if message has URLs but NOT valid ones)
		if (DISALLOWED_MEDIA_REGEX.test(message.content)) {
			const hasYoutube = YOUTUBE_REGEX.test(message.content);
			const hasMedal = MEDAL_REGEX.test(message.content);

			if (!hasYoutube && !hasMedal) {
				await message
					.reply({
						embeds: [
							new EmbedBuilder()
								.setColor("#FF0000")
								.setTitle("Media Not Accepted")
								.setDescription(
									"This media type is not accepted. Please upload via **YouTube**, **Medal**, or **direct file upload**."
								),
						],
					})
					.catch((e) => console.log(e));
			}
		}
	}
}
