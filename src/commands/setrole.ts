import { BaseCommand, ExtendedClient } from "../structure";
import { ChatInputCommandInteraction, CommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export default class SetRoleCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("setrole")
		.setDescription("Set the staff role for ticket access")
		.addRoleOption((opt) =>
			opt
				.setName("role")
				.setDescription("The staff role that can view/manage tickets")
				.setRequired(true)
		) as unknown as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const cmd = interaction as ChatInputCommandInteraction;
		const member = interaction.member as GuildMember | null;
		if (!member?.permissions.has(PermissionFlagsBits.Administrator))
			return interaction.reply({ content: "You need Administrator permission to use this command.", ephemeral: true });

		const role = cmd.options.getRole("role", true).id;
		await this.client.prisma.config.upsert({
			create: { key: "staff_role", value: role },
			update: { value: role },
			where: { key: "staff_role" },
		});

		this.client.config.rolesWhoHaveAccessToTheTickets = [role];
		this.client.runtimeConfig.set("staff_role", role);

		return interaction.reply({ content: `Staff role set to <@&${role}>`, ephemeral: true });
	}
}
