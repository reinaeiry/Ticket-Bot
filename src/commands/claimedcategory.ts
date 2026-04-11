import { BaseCommand, ExtendedClient } from "../structure";
import { ChannelType, ChatInputCommandInteraction, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

export default class ClaimedCategoryCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("claimedcategory")
		.setDescription("Set the category for claimed tickets")
		.addChannelOption((opt) =>
			opt
				.setName("category")
				.setDescription("The Discord category for claimed tickets")
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
			create: { key: "category_claimed", value: category },
			update: { value: category },
			where: { key: "category_claimed" },
		});

		this.client.config.claimOption.categoryWhenClaimed = category;
		this.client.runtimeConfig.set("category_claimed", category);

		return interaction.reply({ content: `Claimed ticket category set to <#${category}>`, ephemeral: true });
	}
}
