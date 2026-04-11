import { EmbedBuilder, TextChannel } from "discord.js";
import { ExtendedClient } from "../structure";
import { autoCloseTicket } from "./autoClose";

const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/i;
const MEDAL_REGEX = /(?:https?:\/\/)?(?:www\.)?medal\.tv\/[\w\/-]+/i;
const EVIDENCE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function startEvidenceMonitor(
	channel: TextChannel,
	client: ExtendedClient,
	ticketCreatorId: string
): void {
	const evidenceEmbed = new EmbedBuilder()
		.setColor("#FFA500")
		.setTitle("Evidence Required")
		.setDescription(
			"**You are required to upload evidence to this ticket. Please have evidence ready.**\n\n" +
			"Only accepted media:\n" +
			"- **YouTube** links\n" +
			"- **Medal** links\n" +
			"- **Direct file uploads** (images, videos, files)\n\n" +
			"Anything outside of these will **not** be accepted.\n\n" +
			"*You have 10 minutes to provide evidence or this ticket will be auto-closed.*"
		);

	channel.send({ embeds: [evidenceEmbed] }).catch((e) => console.log(e));

	let evidenceFound = false;

	const collector = channel.createMessageCollector({
		filter: (msg) => msg.author.id === ticketCreatorId,
		time: EVIDENCE_TIMEOUT_MS,
	});

	collector.on("collect", (msg) => {
		const hasYoutube = YOUTUBE_REGEX.test(msg.content);
		const hasMedal = MEDAL_REGEX.test(msg.content);
		const hasAttachment = msg.attachments.size > 0;

		if (hasYoutube || hasMedal || hasAttachment) {
			evidenceFound = true;
			channel
				.send({
					embeds: [
						new EmbedBuilder()
							.setColor("#43B581")
							.setDescription("Evidence received. Thank you."),
					],
				})
				.catch((e) => console.log(e));
			collector.stop("evidenceFound");
		}
	});

	collector.on("end", (_collected, reason) => {
		if (reason === "time" && !evidenceFound) {
			autoCloseTicket(channel, client, "No evidence provided within 10 minutes.");
		}
	});
}
