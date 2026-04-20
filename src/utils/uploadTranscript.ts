import axios from "axios";
import { Collection, Message, TextChannel } from "discord.js";

export const TRANSCRIPT_DOMAIN = "https://transcripts.reforgedz.net";

export type TranscriptUploadInput = {
	ticketId: number;
	channel: TextChannel;
	category: string;
	createdBy: string;
	createdByName: string;
	closedBy: string;
	closedByName: string;
	closeReason: string;
	autoClosed?: boolean;
	restricted?: boolean;
};

async function fetchAllMessages(channel: TextChannel): Promise<Collection<string, Message>> {
	const collArray: Collection<string, Message>[] = [];
	let lastID = channel.lastMessageId ?? undefined;
	while (lastID) {
		const fetched = await channel.messages.fetch({ limit: 100, before: lastID }).catch(() => null);
		if (!fetched || fetched.size === 0) break;
		collArray.push(fetched);
		lastID = fetched.last()?.id;
		if (fetched.size !== 100) break;
	}
	if (collArray.length === 0) return new Collection<string, Message>();
	return collArray[0].concat(...collArray.slice(1));
}

export async function uploadTranscript(input: TranscriptUploadInput): Promise<string> {
	const messages = await fetchAllMessages(input.channel);

	const messageData = messages.reverse().map((msg) => ({
		author: {
			id: msg.author.id,
			username: msg.author.tag,
			avatar: msg.author.displayAvatarURL({ size: 64 }),
			bot: msg.author.bot,
		},
		content: msg.content,
		timestamp: msg.createdAt.toISOString(),
		embeds: msg.embeds.map((e) => ({
			title: e.title,
			description: e.description,
			color: e.color,
			fields: e.fields,
			footer: e.footer,
			thumbnail: e.thumbnail,
			image: e.image,
		})),
		attachments: msg.attachments.map((a) => ({
			name: a.name,
			url: a.url,
			proxyURL: a.proxyURL,
			size: a.size,
			contentType: a.contentType,
		})),
	}));

	const apiKey = process.env.TRANSCRIPT_API_KEY || "";
	const res = await axios
		.post(
			`${TRANSCRIPT_DOMAIN}/api/upload`,
			{
				ticketId: input.ticketId,
				channelName: input.channel.name,
				category: input.category,
				createdBy: input.createdBy,
				createdByName: input.createdByName,
				closedBy: input.closedBy,
				closedByName: input.closedByName,
				closeReason: input.closeReason,
				autoClosed: !!input.autoClosed,
				restricted: !!input.restricted,
				messages: messageData,
			},
			{
				headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
				timeout: 30000,
			}
		)
		.catch((e) => {
			console.error("Transcript upload error:", e.message);
			return null;
		});

	if (res?.data?.id) return `${TRANSCRIPT_DOMAIN}/t/${res.data.id}`;
	return "";
}
