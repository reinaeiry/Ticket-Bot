import { BaseCommand, ExtendedClient } from "../structure";
import { ChannelType, ChatInputCommandInteraction, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

export default class CloseCategoryCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("closecategory")
		.setDescription("Set the category for closed tickets")
		.addChannelOption((opt) =>
			opt
				.setName("category")
				.setDescription("The Discord category for closed tickets")
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
			create: { key: "category_closed", value: category },
			update: { value: category },
			where: { key: "category_closed" },
		});

		this.client.config.closeOption.closeTicketCategoryId = category;
		this.client.runtimeConfig.set("category_closed", category);

		return interaction.reply({ content: `Closed ticket category set to <#${category}>`, ephemeral: true });
	}
}
