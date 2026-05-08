import { BaseCommand, ExtendedClient } from "../structure";
import { CommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const ALLOWED_ROLES = new Set<string>([
	"1380076466577866772",
	"1380076237489442937",
	"1380076622194937856",
]);
const TARGET_ROLE = "1352369706274787409";

export default class BlanketAssignRoleCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("blanketassignrole")
		.setDescription("TEMP: assign target role to members whose only roles are the allowed set") as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const invoker = interaction.member as GuildMember | null;
		if (!invoker?.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: "Administrator required.", ephemeral: true });
		}
		const guild = interaction.guild;
		if (!guild) return interaction.reply({ content: "Guild only.", ephemeral: true });

		await interaction.deferReply({ ephemeral: true });

		const all = await guild.members.fetch();

		let assigned = 0;
		let alreadyHasTarget = 0;
		let hasOtherRoles = 0;
		let noneOfAllowed = 0;
		let failed = 0;

		for (const m of all.values()) {
			if (m.user.bot) continue;

			const roleIds = m.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);

			if (roleIds.includes(TARGET_ROLE)) { alreadyHasTarget++; continue; }

			const hasAtLeastOneAllowed = roleIds.some((id) => ALLOWED_ROLES.has(id));
			if (!hasAtLeastOneAllowed) { noneOfAllowed++; continue; }

			const allRolesAreAllowed = roleIds.every((id) => ALLOWED_ROLES.has(id));
			if (!allRolesAreAllowed) { hasOtherRoles++; continue; }

			try {
				await m.roles.add(TARGET_ROLE, "Blanket role assignment");
				assigned++;
			} catch (e) {
				failed++;
				console.log(`blanketassignrole failed for ${m.id}:`, e);
			}
		}

		await interaction.editReply({
			content: `Done. Assigned: **${assigned}**. Already had target: ${alreadyHasTarget}. Has unrelated roles: ${hasOtherRoles}. None of allowed: ${noneOfAllowed}. Failed: ${failed}.`,
		});
	}
}
