import { BaseCommand, ExtendedClient } from "../structure";
import { ChannelType, ChatInputCommandInteraction, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

export default class Na2CategoryOpenCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("na2categoryopen")
		.setDescription("Set the NA2 open ticket category")
		.addChannelOption((opt) =>
			opt
				.setName("category")
				.setDescription("The Discord category for NA2 open tickets")
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
			create: { key: "category_na2_open", value: category },
			update: { value: category },
			where: { key: "category_na2_open" },
		});

		const tt = this.client.config.ticketTypes.find((t) => t.codeName === "na2-support");
		if (tt) tt.categoryId = category;
		this.client.runtimeConfig.set("category_na2_open", category);

		return interaction.reply({ content: `NA2 open ticket category set to <#${category}>`, ephemeral: true });
	}
}
