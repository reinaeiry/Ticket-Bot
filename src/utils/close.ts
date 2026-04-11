import axios from "axios";
import {
	ActionRow,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChannelType,
	Collection,
	ColorResolvable,
	CommandInteraction,
	ComponentType,
	EmbedBuilder,
	GuildMember,
	Message,
	MessageActionRowComponent,
	ModalSubmitInteraction,
	TextChannel
} from "discord.js";
import { ExtendedClient, TicketType } from "../structure";
import { log } from "./logs";

const TRANSCRIPT_DOMAIN = "https://transcripts.reforgedz.net";

type ticketType = {
	id: number;
	channelid: string;
	messageid: string;
	category: string;
	invited: string;
	reason: string;
	creator: string;
	createdat: bigint;
	claimedby: string | null;
	claimedat: bigint | null;
	closedby: string | null;
	closedat: bigint | null;
	closereason: string | null;
	transcript: string | null;
};

export async function close(
	interaction: ButtonInteraction | CommandInteraction | ModalSubmitInteraction,
	client: ExtendedClient,
	reason?: string,
	deleteTicket: boolean = false
) {

	if(!interaction.channel || interaction.channel.type !== ChannelType.GuildText)
		return await interaction.reply({
			content: "This command can only be used in a ticket channel.",
			ephemeral: true
		});

	const ticket = await client.prisma.tickets.findUnique({
		where: {
			channelid: interaction.channel.id
		}
	});
	const ticketClosed = ticket?.closedat && ticket.closedby;
	if (!ticket) return interaction.editReply({ content: "Ticket not found" }).catch((e) => console.log(e));

	const ticketType = ticket ? (JSON.parse(ticket.category) as TicketType) : undefined;

	if (
		client.config.closeOption.whoCanCloseTicket === "STAFFONLY" &&
		!(interaction.member as GuildMember | null)?.roles.cache.some(
			(r) => client.config.rolesWhoHaveAccessToTheTickets.includes(r.id) || ticketType?.staffRoles?.includes(r.id)
		)
	)
		return interaction
			.editReply({
				content: client.locales.getValue("ticketOnlyClosableByStaff")
			})
			.catch((e) => console.log(e));

	if (ticketClosed)
		return interaction
			.editReply({
				content: client.locales.getValue("ticketAlreadyClosed")
			})
			.catch((e) => console.log(e));

	log(
		{
			LogType: "ticketClose",
			user: interaction.user,
			ticketId: ticket.id,
			ticketChannelId: interaction.channel.id,
			ticketCreatedAt: ticket.createdat,
			reason: reason
		},
		client
	);

	const creator = ticket.creator;
	const invited = JSON.parse(ticket.invited) as string[];

	interaction.channel.permissionOverwrites
		.edit(creator, {
			ViewChannel: false
		})
		.catch((e: unknown) => console.log(e));
	for (const user of invited) {
		await (interaction.channel as TextChannel | null)?.permissionOverwrites
			.edit(user, {
				ViewChannel: false
			});
	}

	interaction
		.editReply({
			content: client.locales.getValue("ticketCreatingTranscript")
		})
		.catch((e) => console.log(e));

	// Fetch all messages from the channel
	async function fetchAll() {
		const collArray: Collection<string, Message<true | false>>[] = [];
		let lastID = (interaction.channel as TextChannel | null)?.lastMessageId;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			if (!lastID) break;
			const fetched = await interaction.channel?.messages.fetch({ limit: 100, before: lastID });
			if (fetched?.size === 0) break;
			if (fetched) collArray.push(fetched);
			lastID = fetched?.last()?.id;
			if (fetched?.size !== 100) break;
		}
		if (collArray.length === 0) return new Collection<string, Message>();
		return collArray[0].concat(...collArray.slice(1));
	}

	// Build transcript data
	let transcriptUrl = "";
	let transcriptId = "";

	const isBanAppeal = ticketType?.codeName === "ban-appeal";

	if (client.config.closeOption.createTranscript && !isBanAppeal) {
		try {
			const messages = await fetchAll();
			const creatorUser = await client.users.fetch(creator).catch(() => null);

			// Convert Discord messages to a storable format
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
			const res = await axios.post(
				`${TRANSCRIPT_DOMAIN}/api/upload`,
				{
					ticketId: ticket.id,
					channelName: (interaction.channel as TextChannel).name,
					category: ticketType?.name || "Unknown",
					createdBy: creator,
					createdByName: creatorUser?.tag || creator,
					closedBy: interaction.user.id,
					closedByName: interaction.user.tag,
					closeReason: reason || "No reason given",
					messages: messageData,
				},
				{
					headers: {
						"Content-Type": "application/json",
						"X-Api-Key": apiKey,
					},
					timeout: 30000,
				}
			).catch((e) => { console.error("Transcript upload error:", e.message); return null; });

			if (res?.data?.id) {
				transcriptId = res.data.id;
				transcriptUrl = `${TRANSCRIPT_DOMAIN}/t/${transcriptId}`;
			}
		} catch (e) {
			console.error("Transcript generation error:", e);
		}
	}

	// Finalize close
	if (client.config.closeOption.closeTicketCategoryId)
		(interaction.channel as TextChannel | null)?.setParent(client.config.closeOption.closeTicketCategoryId).catch((e) => console.log(e));

	const msg = await interaction.channel?.messages.fetch(ticket.messageid);
	const embed = new EmbedBuilder(msg?.embeds[0].data);

	const rowAction = new ActionRowBuilder<ButtonBuilder>();
	(msg?.components[0] as ActionRow<MessageActionRowComponent>)?.components?.map((x) => {
		if (x.type !== ComponentType.Button) return;
		const builder = new ButtonBuilder(x.data);
		if (x.customId === "close") builder.setDisabled(true);
		if (x.customId === "close_askReason") builder.setDisabled(true);
		rowAction.addComponents(builder);
	});

	msg?.edit({
		content: msg.content,
		embeds: [embed],
		components: [rowAction]
	}).catch((e) => console.log(e));

	if(interaction.channel && interaction.channel.type !== ChannelType.GuildText)
		throw Error("Close util used in a non-text channel");

	interaction.channel?.send({
		content: transcriptUrl
			? client.locales.getValue("ticketTranscriptCreated").replace("TRANSCRIPTURL", `<${transcriptUrl}>`)
			: "> Transcript unavailable"
	}).catch((e) => console.log(e));

	let updatedTicket = await client.prisma.tickets.update({
		data: {
			closedby: interaction.user.id,
			closedat: Date.now(),
			closereason: reason,
			transcript: transcriptUrl || null
		},
		where: {
			channelid: interaction.channel?.id
		}
	});

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("deleteTicket")
			.setLabel(client.locales.getSubValue("other", "deleteTicketButtonMSG"))
			.setStyle(ButtonStyle.Danger)
			.setDisabled(true)
	);
	const locale = client.locales;
	const safeTicketCount = JSON.stringify(updatedTicket.id.toString()).slice(1, -1);
	const safeReason = JSON.stringify(
		(updatedTicket.closereason ?? client.locales.getSubValue("other", "noReasonGiven")).replace(/[\n\r]/g, "\\n")
	).slice(1, -1);
	const safeCloserName = JSON.stringify(interaction.user.tag).slice(1, -1);
	interaction.channel?.send({
		embeds: [
			JSON.parse(
				JSON.stringify(locale.getSubRawValue("embeds", "ticketClosed"))
					.replace("TICKETCOUNT", safeTicketCount)
					.replace("REASON", safeReason)
					.replace("CLOSERNAME", safeCloserName)
			)
		],
		components: [row]
	}).catch((e) => console.log(e));

	// Auto-delete after configurable delay
	{
		const delayMinutes = parseInt(client.runtimeConfig.get("closed_delete_delay") ?? "10", 10);
		const delayMs = delayMinutes * 60 * 1000;

		log(
			{
				LogType: "ticketDelete",
				user: interaction.user,
				ticketId: updatedTicket.id,
				ticketCreatedAt: updatedTicket.createdat,
				transcriptURL: updatedTicket.transcript ?? undefined
			},
			client
		);

		interaction.channel?.send({
			content: `> This ticket will be deleted in ${delayMinutes} minute${delayMinutes !== 1 ? "s" : ""}.`
		});
		setTimeout(() => interaction.channel?.delete().catch((e) => console.log(e)), delayMs);
	}

	if (!client.config.closeOption.dmUser || isBanAppeal) return;
	const footer = locale.getSubValue("embeds", "ticketClosedDM", "footer", "text");
	const ticketClosedDMEmbed = new EmbedBuilder({
		color: 0
	})
		.setColor((locale.getNoErrorSubValue("embeds", "ticketClosedDM", "color") as ColorResolvable) ?? client.config.mainColor)
		.setDescription(
			client.locales
				.getSubValue("embeds", "ticketClosedDM", "description")
				.replace("TICKETCOUNT", updatedTicket.id.toString())
				.replace("TRANSCRIPTURL", transcriptUrl || "Unavailable")
				.replace("REASON", updatedTicket.closereason ?? client.locales.getSubValue("other", "noReasonGiven"))
				.replace("CLOSERNAME", interaction.user.tag)
		)
		.setFooter({
			text: `ReforgedZ ${footer.trim() !== "" ? `- ${footer}` : ""}`,
			iconURL: locale.getNoErrorSubValue("embeds", "ticketClosedDM", "footer", "iconUrl")
		});

	client.users.fetch(creator).then((user) => {
		user.send({ embeds: [ticketClosedDMEmbed] }).catch((e) => console.log(e));
	});
}
