import { BaseCommand, ExtendedClient } from "../structure";
import { ChatInputCommandInteraction, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

export default class SetClosedDelayCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("setcloseddelay")
		.setDescription("Set the auto-delete delay for closed tickets (in minutes)")
		.addIntegerOption((opt) =>
			opt
				.setName("minutes")
				.setDescription("Minutes before a closed ticket is auto-deleted")
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(60)
		) as unknown as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const cmd = interaction as ChatInputCommandInteraction;
		const member = interaction.member as GuildMember | null;
		if (
			!member?.roles.cache.some((r) =>
				this.client.config.rolesWhoHaveAccessToTheTickets.includes(r.id) ||
				this.client.config.ticketTypes.some((t) => t.staffRoles?.includes(r.id))
			)
		)
			return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });

		const minutes = cmd.options.getInteger("minutes", true);
		await this.client.prisma.config.upsert({
			create: { key: "closed_delete_delay", value: minutes.toString() },
			update: { value: minutes.toString() },
			where: { key: "closed_delete_delay" },
		});

		this.client.runtimeConfig.set("closed_delete_delay", minutes.toString());

		return interaction.reply({
			content: `Closed tickets will now be auto-deleted after ${minutes} minute${minutes !== 1 ? "s" : ""}.`,
			ephemeral: true,
		});
	}
}
