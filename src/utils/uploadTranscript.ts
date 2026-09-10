import axios from "axios";
import { Collection, Message, TextChannel } from "discord.js";

export const TRANSCRIPT_DOMAIN = "https://transcripts.reforgedz.net";

// A re-link URL is an account-takeover credential: opening it signs that browser
// into the account. /relink posts one into the ticket channel deliberately, and
// that is an accepted decision - but the transcript is a SECOND copy, on another
// host, that outlives the channel. Support-category transcripts are served to
// anyone holding the share link, and close.ts posts that link in-channel and DMs
// it to the ticket creator. An unclicked token stays valid for its full TTL, so a
// ticket closed before the player clicks would otherwise publish a working
// credential that no later Discord message-delete can reach.
//
// Redact at the export boundary rather than at the post: that covers the bot's own
// embed, a staff member pasting the link a second time, and anything added later.
const CREDENTIAL_PATTERNS: RegExp[] = [/(console-relink[?]token=)[A-Za-z0-9_-]+/gi];

function redactCredentials<T extends string | null | undefined>(value: T): T {
	if (typeof value !== "string" || value.length === 0) return value;
	let out: string = value;
	for (const re of CREDENTIAL_PATTERNS) out = out.replace(re, "$1[REDACTED]");
	return out as T;
}

export type TranscriptUploadInput = {
	ticketId: number;
	channel: TextChannel;
	category: string;
	/** TicketType.codeName — the machine key the archive gates access on. */
	categoryCode?: string;
	createdBy: string;
	createdByName: string;
	closedBy: string;
	closedByName: string;
	closeReason: string;
	autoClosed?: boolean;
	restricted?: boolean;
};

async function fetchAllMessages(channel: TextChannel): Promise<Collection<string, Message>> {
	// Discord's messages.fetch({ before: id }) is EXCLUSIVE of `id`, so
	// passing channel.lastMessageId as the cursor would silently drop the
	// most recent message (e.g. an admin-relay reply that came in right
	// before close). Always start with an un-anchored fetch so the very
	// last message is included, then page backwards from the oldest of
	// that batch.
	const collArray: Collection<string, Message>[] = [];
	let cursor: string | undefined = undefined;
	while (true) {
		const opts: { limit: number; before?: string } = { limit: 100 };
		if (cursor) opts.before = cursor;
		const fetched = await channel.messages.fetch(opts).catch(() => null);
		if (!fetched || fetched.size === 0) break;
		collArray.push(fetched);
		if (fetched.size < 100) break;
		cursor = fetched.last()?.id;
		if (!cursor) break;
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
		content: redactCredentials(msg.content),
		timestamp: msg.createdAt.toISOString(),
		embeds: msg.embeds.map((e) => ({
			title: redactCredentials(e.title),
			description: redactCredentials(e.description),
			color: e.color,
			fields: (e.fields ?? []).map((f) => ({ ...f, value: redactCredentials(f.value) })),
			footer: e.footer ? { ...e.footer, text: redactCredentials(e.footer.text) } : e.footer,
			thumbnail: e.thumbnail,
			image: e.image,
			author: e.author ? { name: e.author.name, iconURL: e.author.iconURL } : undefined,
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
				categoryCode: input.categoryCode || null,
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
