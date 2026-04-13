import {
	ActionRow,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Collection,
	ComponentType,
	EmbedBuilder,
	Message,
	MessageActionRowComponent,
	TextChannel,
} from "discord.js";
import { ExtendedClient } from "../structure";

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

	// Update database
	const updatedTicket = await client.prisma.tickets.update({
		data: {
			closedby: client.user?.id ?? "system",
			closedat: Date.now(),
			closereason: reason,
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
