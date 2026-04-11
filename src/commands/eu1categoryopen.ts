import { BaseCommand, ExtendedClient } from "../structure";
import { ChannelType, ChatInputCommandInteraction, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

export default class Eu1CategoryOpenCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("eu1categoryopen")
		.setDescription("Set the EU1 open ticket category")
		.addChannelOption((opt) =>
			opt
				.setName("category")
				.setDescription("The Discord category for EU1 open tickets")
				.addChannelTypes(ChannelType.GuildCategory)
				.setRequired(true)
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

		const category = cmd.options.getChannel("category", true).id;
		await this.client.prisma.config.upsert({
			create: { key: "category_eu1_open", value: category },
			update: { value: category },
			where: { key: "category_eu1_open" },
		});

		const tt = this.client.config.ticketTypes.find((t) => t.codeName === "eu1-support");
		if (tt) tt.categoryId = category;
		this.client.runtimeConfig.set("category_eu1_open", category);

		return interaction.reply({ content: `EU1 open ticket category set to <#${category}>`, ephemeral: true });
	}
}
