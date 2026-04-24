import { BaseCommand, ExtendedClient, TicketType } from "../structure";
import { ChannelType, CommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from "discord.js";

export default class SyncPermsCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("syncperms")
		.setDescription("Reapply current config staffRoles to every open ticket") as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const member = interaction.member as GuildMember | null;
		const isAdmin = member?.roles.cache.some((r) =>
			this.client.config.rolesWhoHaveAccessToTheTickets.includes(r.id)
		);
		if (!isAdmin) {
			return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
		}

		await interaction.deferReply({ ephemeral: true });

		const openTickets = await this.client.prisma.tickets.findMany({
			where: { closedat: null },
			select: { channelid: true, category: true, id: true },
		});

		let updated = 0;
		let skipped = 0;
		let missingChannel = 0;

		for (const ticket of openTickets) {
			const channel = interaction.guild?.channels.cache.get(ticket.channelid) as TextChannel | undefined;
			if (!channel || channel.type !== ChannelType.GuildText) {
				missingChannel++;
				continue;
			}

			let storedType: TicketType | undefined;
			try {
				storedType = JSON.parse(ticket.category) as TicketType;
			} catch {
				skipped++;
				continue;
			}

			const currentType = this.client.config.ticketTypes.find((t) => t.codeName === storedType?.codeName);
			if (!currentType) {
				skipped++;
				continue;
			}

			const roles = [
				...this.client.config.rolesWhoHaveAccessToTheTickets,
				...(currentType.staffRoles ?? []),
			];

			for (const roleId of roles) {
				await channel.permissionOverwrites
					.edit(roleId, {
						ViewChannel: true,
						SendMessages: true,
						AddReactions: true,
						ReadMessageHistory: true,
						AttachFiles: true,
					})
					.catch((e) => console.log(`syncperms ${ticket.id} role ${roleId}:`, e));
			}

			updated++;
		}

		await interaction.editReply({
			content: `Synced perms on **${updated}** open tickets. Skipped: ${skipped}. Channel missing: ${missingChannel}.`,
		});
	}
}
