import { BaseCommand, ExtendedClient } from "../structure";
import {
	ChatInputCommandInteraction,
	CommandInteraction,
	EmbedBuilder,
	GuildMember,
	SlashCommandBuilder,
} from "discord.js";

// Console sign-in has no ownership proof, so once an account exists the shop
// only admits the browser holding the signed cookie from the original link. A
// player who clears cookies or picks up a different device is locked out of
// their own paid account, and the refusal tells them to open a ticket.
//
// This is the other half of that: staff verify who they are talking to in the
// ticket, run /relink, and hand over a single-use link. The shop owns the
// tokens; this is a thin remote control over its admin API, same as /billing.
const SHOP_BASE_URL = process.env["SHOP_BASE_URL"] || "https://reforgedz.net";
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

interface RelinkResponse {
	ok: boolean;
	url: string;
	expiresAt: number;
	expiresInMinutes: number;
	gamertag: string;
	platform: string;
}

export default class RelinkCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("relink")
		.setDescription("Issue a console re-link for a player locked out of their account")
		.addStringOption((opt) =>
			opt
				.setName("gamertag")
				.setDescription("Their Xbox or PlayStation gamertag (or BattleMetrics player id)")
				.setRequired(true)
		) as unknown as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction): Promise<void> {
		const member = interaction.member as GuildMember | null;
		const isStaff = member?.roles.cache.some((r) =>
			this.client.config.rolesWhoHaveAccessToTheTickets.includes(r.id)
		);
		if (!isStaff) {
			await interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true,
			});
			return;
		}

		if (!SHOP_ADMIN_API_KEY) {
			await interaction.reply({
				content: "SHOP_ADMIN_API_KEY is not set on the bot, so it can't reach the shop.",
				ephemeral: true,
			});
			return;
		}

		const chat = interaction as ChatInputCommandInteraction;
		const raw = (chat.options.getString("gamertag") || "").trim();
		if (!raw) {
			await interaction.reply({ content: "Give me a gamertag.", ephemeral: true });
			return;
		}

		// Ephemeral for the whole flow: the link is a credential. Whoever opens it
		// gets that account and its purchase history, so it must never land in a
		// channel the player -- or anyone else -- can read. Staff pass it on
		// deliberately once they are satisfied who they are talking to.
		await interaction.deferReply({ ephemeral: true });

		const body = /^\d+$/.test(raw) ? { bmPlayerId: raw } : { gamertag: raw };

		let data: RelinkResponse;
		try {
			const res = await fetch(`${SHOP_BASE_URL}/api/shop/admin/console/relink`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-shop-admin-key": SHOP_ADMIN_API_KEY,
				},
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { error?: string };
				await interaction.editReply({
					content: err.error
						? `Shop said: ${err.error}`
						: `The shop returned ${res.status}.`,
				});
				return;
			}
			data = (await res.json()) as RelinkResponse;
		} catch (e) {
			await interaction.editReply({
				content: `Couldn't reach the shop: ${(e as Error).message}`,
			});
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle("Console re-link")
			.setColor(0x2ecc71)
			.setDescription(
				[
					`**${data.gamertag}** · ${data.platform.toUpperCase()}`,
					"",
					"Send this to the player and have them open it **on the device they want to stay signed in on**.",
					"",
					`\`\`\`${data.url}\`\`\``,
				].join("\n")
			)
			.addFields(
				{ name: "Expires", value: `<t:${data.expiresAt}:R>`, inline: true },
				{ name: "Uses", value: "One, then it is dead", inline: true }
			)
			.setFooter({
				text: "Only you can see this. Check they are who they say before sending it — a gamertag is public.",
			});

		await interaction.editReply({ embeds: [embed] });
	}
}
