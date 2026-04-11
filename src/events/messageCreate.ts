import { EmbedBuilder, Message } from "discord.js";
import { ExtendedClient } from "../structure";

const DISALLOWED_MEDIA_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv|clips\.twitch\.tv|streamable\.com|vimeo\.com|dailymotion\.com|facebook\.com\/.*\/videos)/i;
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/i;
const MEDAL_REGEX = /(?:https?:\/\/)?(?:www\.)?medal\.tv\/[\w\/-]+/i;

export default class MessageCreateEvent {
	private readonly client: ExtendedClient;
	constructor(client: ExtendedClient) {
		this.client = client;
	}

	public async execute(message: Message): Promise<void> {
		if (message.author.bot) return;
		if (!message.guild) return;

		// Check if this is a ticket channel
		const ticket = await this.client.prisma.tickets.findUnique({
			where: { channelid: message.channel.id },
		});
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
