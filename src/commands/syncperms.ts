import { BaseCommand, ExtendedClient, TicketType } from "../structure";
import { ChannelType, CommandInteraction, GuildMember, OverwriteType, SlashCommandBuilder, TextChannel } from "discord.js";

export default class SyncPermsCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("syncperms")
		.setDescription("Reapply current config staffRoles to every open ticket") as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const member = interaction.member as GuildMember | null;
		// Match the gate every other admin command uses. Checking only
		// `rolesWhoHaveAccessToTheTickets` meant just the single global `staff_role`
		// (Global Admin) could run this — a Founder was refused.
		const isAdmin = member?.roles.cache.some((r) =>
			this.client.config.rolesWhoHaveAccessToTheTickets.includes(r.id) ||
			this.client.config.ticketTypes.some((t) => t.staffRoles?.includes(r.id))
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
		let pruned = 0;

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

			// Authoritative list — see the note in createTicket.ts. Reapplying the global
			// `staff_role` here would put back exactly the leak this removes.
			for (const roleId of currentType.staffRoles ?? []) {
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

			for (const roleId of currentType.blockedRoles ?? []) {
				await channel.permissionOverwrites
					.edit(roleId, {
						ViewChannel: false,
						SendMessages: false,
						AddReactions: false,
						ReadMessageHistory: false,
						AttachFiles: false,
					})
					.catch((e) => console.log(`syncperms ${ticket.id} block ${roleId}:`, e));
			}

			// Prune ROLE overwrites config no longer sanctions. Without this the command
			// only ever widens access: a role dropped from `staffRoles` keeps the allow it
			// was granted when the ticket was opened, so tightening config fixes new
			// tickets and silently leaves every open one exposed.
			//
			// Member overwrites are deliberately untouched — those are the ticket opener
			// and anyone added via /add, which config knows nothing about.
			const sanctioned = new Set<string>([
				...(currentType.staffRoles ?? []),
				...(currentType.blockedRoles ?? []),
				channel.guild.roles.everyone.id
			]);
			for (const [id, ow] of channel.permissionOverwrites.cache) {
				if (ow.type !== OverwriteType.Role) continue;
				if (sanctioned.has(id)) continue;
				await ow
					.delete(`syncperms: role not in staffRoles for ${currentType.codeName}`)
					.then(() => { pruned++; })
					.catch((e) => console.log(`syncperms ${ticket.id} prune ${id}:`, e));
			}

			updated++;
		}

		await interaction.editReply({
			content: `Synced perms on **${updated}** open tickets (**${pruned}** stale role overwrite(s) removed). Skipped: ${skipped}. Channel missing: ${missingChannel}.`,
		});
	}
}
