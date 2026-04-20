import {
	ActionRow,
	ActionRowBuilder,
	ButtonBuilder,
	ComponentType,
	EmbedBuilder,
	MessageActionRowComponent,
	TextChannel,
} from "discord.js";
import { ExtendedClient, TicketType } from "../structure";
import { uploadTranscript } from "./uploadTranscript";

export async function autoCloseTicket(
	channel: TextChannel,
	client: ExtendedClient,
	reason: string
): Promise<void> {
	const ticket = await client.prisma.tickets.findUnique({
		where: { channelid: channel.id },
	});
	if (!ticket || ticket.closedat) return;

	const creator = ticket.creator;

	// Lock the channel - nobody sees closed tickets except the bot
	const overwrites: any[] = [
		{ id: channel.guild.roles.everyone.id, deny: ["ViewChannel"] },
	];
	if (client.user) {
		overwrites.push({ id: client.user.id, allow: ["ViewChannel", "SendMessages", "ManageChannels"] });
	}
	await channel.permissionOverwrites.set(overwrites).catch((e: unknown) => console.log(e));

	// Disable close buttons on the original message
	try {
		const msg = await channel.messages.fetch(ticket.messageid);
		if (msg) {
			const embed = new EmbedBuilder(msg.embeds[0]?.data);
			const rowAction = new ActionRowBuilder<ButtonBuilder>();
			(msg.components[0] as ActionRow<MessageActionRowComponent>)?.components?.map((x) => {
				if (x.type !== ComponentType.Button) return;
				const builder = new ButtonBuilder(x.data);
				if (x.customId === "close" || x.customId === "close_askReason") builder.setDisabled(true);
				rowAction.addComponents(builder);
			});
			await msg.edit({
				content: msg.content,
				embeds: [embed],
				components: rowAction.components.length > 0 ? [rowAction] : [],
			}).catch((e) => console.log(e));
		}
	} catch (e) {
		console.log(e);
	}

	// Upload transcript flagged as auto-closed
	const autoCloseReason = "Autoclosed - No Evidence";
	let transcriptUrl = "";
	if (client.config.closeOption.createTranscript) {
		try {
			const ticketType = JSON.parse(ticket.category) as TicketType;
			const creatorUser = await client.users.fetch(creator).catch(() => null);
			transcriptUrl = await uploadTranscript({
				ticketId: ticket.id,
				channel,
				category: ticketType?.name || "Unknown",
				createdBy: creator,
				createdByName: creatorUser?.tag || creator,
				closedBy: client.user?.id ?? "system",
				closedByName: client.user?.tag ?? "system",
				closeReason: autoCloseReason,
				autoClosed: true,
			});
		} catch (e) {
			console.error("Auto-close transcript error:", e);
		}
	}

	// Update database
	const updatedTicket = await client.prisma.tickets.update({
		data: {
			closedby: client.user?.id ?? "system",
			closedat: Date.now(),
			closereason: autoCloseReason,
			transcript: transcriptUrl || null,
		},
		where: { channelid: channel.id },
	});

	// Send close embed
	const closeEmbed = new EmbedBuilder()
		.setColor("#ED4245")
		.setTitle("Ticket Auto-Closed")
		.setDescription(reason);

	await channel.send({ embeds: [closeEmbed] }).catch((e) => console.log(e));

	// Auto-delete timer
	const delayMinutes = parseInt(client.runtimeConfig.get("closed_delete_delay") ?? "10", 10);
	const delayMs = delayMinutes * 60 * 1000;

	await channel
		.send({
			content: `> This ticket will be deleted in ${delayMinutes} minute${delayMinutes !== 1 ? "s" : ""}.`,
		})
		.catch((e) => console.log(e));

	setTimeout(() => channel.delete().catch((e) => console.log(e)), delayMs);

	// DM the ticket creator
	if (client.config.closeOption.dmUser) {
		try {
			const user = await client.users.fetch(creator);
			const dmEmbed = new EmbedBuilder()
				.setColor("#ED4245")
				.setTitle("Ticket Auto-Closed")
				.setDescription(
					`Your ticket #${updatedTicket.id} was auto-closed.\nReason: \`${reason}\``
				);
			await user.send({ embeds: [dmEmbed] }).catch((e) => console.log(e));
		} catch (e) {
			console.log(e);
		}
	}
}
