import { ChannelType, GuildMember, TextChannel } from "discord.js";
import { ExtendedClient, TicketType } from "../structure";
import { log } from "./logs";
import { uploadTranscript } from "./uploadTranscript";

function normalizeName(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Best-effort fuzzy match of an admin username against the bot's cached
// guild members. Returns the matched member or null. Matches in order:
//   1. exact case-insensitive equality on username, displayName, or nickname
//   2. normalized equality (strip punctuation, lowercase)
//   3. unique substring match on normalized forms
// "Unknown" / empty inputs always return null.
function findGuildMemberByName(client: ExtendedClient, name: string): GuildMember | null {
	const guildId = client.config.guildId;
	const guild = guildId ? client.guilds.cache.get(guildId) : null;
	if (!guild || !name) return null;
	const norm = normalizeName(name);
	if (!norm) return null;
	const members = Array.from(guild.members.cache.values());

	for (const m of members) {
		if (m.user.username.toLowerCase() === name.toLowerCase()) return m;
		if (m.displayName.toLowerCase() === name.toLowerCase()) return m;
	}
	for (const m of members) {
		if (normalizeName(m.user.username) === norm) return m;
		if (normalizeName(m.displayName) === norm) return m;
	}
	const subs = members.filter((m) =>
		normalizeName(m.user.username).includes(norm) ||
		normalizeName(m.displayName).includes(norm)
	);
	if (subs.length === 1) return subs[0];
	return null;
}

export type ProgrammaticCloseInput = {
	channelId: string;
	// Admin's username from auth.reforgedz.net (e.g. "eiry"). If left empty
	// we fall back to closedByName and skip the Discord-member lookup.
	closedByUsername?: string;
	// Pre-resolved Discord ID (rare — usually empty so we resolve).
	closedByDiscordId?: string;
	// Display name (will be replaced by the resolved member.tag when found).
	closedByName: string;
	reason: string;
};

export type ProgrammaticCloseResult = {
	ok: boolean;
	error?: "not_found" | "already_closed" | "channel_unavailable" | "internal_error";
	transcript?: string | null;
	ticketId?: number;
};

// Mirrors the user-interaction close() in src/utils/close.ts but driven by a
// channel id + closer identity rather than a Discord interaction. Used by the
// admin web panel's POST /api/internal/tickets/:channelId/close endpoint so
// staff can close from the relay without bouncing to Discord.
export async function closeTicketProgrammatic(
	client: ExtendedClient,
	input: ProgrammaticCloseInput
): Promise<ProgrammaticCloseResult> {
	const ticket = await client.prisma.tickets.findUnique({
		where: { channelid: input.channelId }
	});
	if (!ticket) return { ok: false, error: "not_found" };
	if (ticket.closedat && ticket.closedby) return { ok: false, error: "already_closed", ticketId: ticket.id };

	let channel: TextChannel;
	try {
		const fetched = await client.channels.fetch(input.channelId);
		if (!fetched || fetched.type !== ChannelType.GuildText) {
			return { ok: false, error: "channel_unavailable" };
		}
		channel = fetched as TextChannel;
	} catch {
		return { ok: false, error: "channel_unavailable" };
	}

	const ticketType = JSON.parse(ticket.category) as TicketType;
	const creator = ticket.creator;

	// Resolve a real Discord member from the admin's auth username. If we
	// can find one, use their actual tag + id for attribution; otherwise
	// fall back to the supplied display name with no Discord ID so the
	// transcript and audit don't fabricate a fake @mention.
	const matchedMember = input.closedByUsername
		? findGuildMemberByName(client, input.closedByUsername)
		: null;
	const closerId = matchedMember?.id || input.closedByDiscordId || "";
	const closerName = matchedMember?.user.tag || input.closedByName;
	const closer = { id: closerId, tag: closerName } as { id: string; tag: string };
	log(
		{
			LogType: "ticketClose",
			user: closer as any,
			ticketId: ticket.id,
			ticketChannelId: input.channelId,
			ticketCreatedAt: ticket.createdat,
			reason: input.reason
		},
		client
	);

	if (channel.guild) {
		const overwrites: any[] = [
			{ id: channel.guild.roles.everyone.id, deny: ["ViewChannel"] }
		];
		if (client.user) {
			overwrites.push({ id: client.user.id, allow: ["ViewChannel", "SendMessages", "ManageChannels"] });
		}
		await channel.permissionOverwrites.set(overwrites).catch((e) => console.log(e));
	}

	let transcriptUrl = "";
	const isRestricted =
		ticketType?.codeName === "ban-appeal" ||
		ticketType?.codeName === "dev-application" ||
		ticketType?.codeName === "gm-application" ||
		ticketType?.codeName === "shop-support" ||
		ticketType?.codeName === "contact-management";

	if (client.config.closeOption.createTranscript) {
		try {
			const creatorUser = await client.users.fetch(creator).catch(() => null);
			transcriptUrl = await uploadTranscript({
				ticketId: ticket.id,
				channel,
				category: ticketType?.name || "Unknown",
				createdBy: creator,
				createdByName: creatorUser?.tag || creator,
				closedBy: closerId,
				closedByName: closerName,
				closeReason: input.reason,
				restricted: isRestricted
			});
		} catch (e) {
			console.error("[closeTicketProgrammatic] transcript error:", e);
		}
	}

	if (client.config.closeOption.closeTicketCategoryId) {
		channel.setParent(client.config.closeOption.closeTicketCategoryId, { lockPermissions: false }).catch((e) => console.log(e));
	}

	const updated = await client.prisma.tickets.update({
		data: {
			closedby: closerId,
			closedat: Date.now(),
			closereason: input.reason,
			transcript: transcriptUrl || null
		},
		where: { channelid: input.channelId }
	});

	channel.send({
		content: transcriptUrl
			? `> Ticket closed by **${closerName}** via admin panel — Transcript: <${transcriptUrl}>\n> Reason: ${input.reason}`
			: `> Ticket closed by **${closerName}** via admin panel\n> Reason: ${input.reason}`
	}).catch((e) => console.log(e));

	{
		const delayMinutes = parseInt(client.runtimeConfig.get("closed_delete_delay") ?? "10", 10);
		const delayMs = delayMinutes * 60 * 1000;
		log(
			{
				LogType: "ticketDelete",
				user: closer as any,
				ticketId: updated.id,
				ticketCreatedAt: updated.createdat,
				transcriptURL: updated.transcript ?? undefined
			},
			client
		);
		channel.send({
			content: `> This ticket will be deleted in ${delayMinutes} minute${delayMinutes !== 1 ? "s" : ""}.`
		}).catch((e) => console.log(e));
		setTimeout(() => channel.delete().catch((e) => console.log(e)), delayMs);
	}

	return { ok: true, transcript: transcriptUrl || null, ticketId: updated.id };
}
