import { BaseCommand, ExtendedClient } from "../structure";
import {
	ChatInputCommandInteraction,
	CommandInteraction,
	EmbedBuilder,
	GuildMember,
	SlashCommandBuilder,
} from "discord.js";

// The shop owns all billing state; this command is a thin remote control over
// its admin API. Talking to the shop's SQLite directly from here would mean
// two writers on one database, so everything goes over HTTP with the shared
// admin key (the same one the admin page backend uses).
const SHOP_BASE_URL = process.env["SHOP_BASE_URL"] || "https://reforgedz.net";
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

// #Payment-Processor. The output carries payer emails and PayPal ids, so the
// command refuses to run anywhere else even for someone who has the role.
const PAYMENT_PROCESSOR_CHANNEL_ID =
	process.env["PAYMENT_PROCESSOR_CHANNEL_ID"] || "1481277655826305204";

interface BillingIssue {
	paypal_subscription_id: string;
	persona: string | null;
	gamertag: string | null;
	discord_id: string | null;
	product_title: string | null;
	failed_count: number;
	outstanding_cents: number;
	last_payment_at: number | null;
	effective_until: number | null;
	player_emailed_at: number | null;
	resolved_at: number | null;
}

interface BillingResponse {
	issues: BillingIssue[];
	openCount: number;
	outstandingCents: number;
	rescan: {
		running: boolean;
		startedAt: number | null;
		finishedAt: number | null;
		summary: { scanned: number; failing: number; newIssues: number; resolved: number; errors: number } | null;
		error: string | null;
	};
}

async function shopFetch(path: string, init?: RequestInit) {
	const res = await fetch(`${SHOP_BASE_URL}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			"x-shop-admin-key": SHOP_ADMIN_API_KEY,
			...(init?.headers ?? {}),
		},
	});
	return res;
}

const money = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;
const day = (unix: number | null) => (unix ? `<t:${unix}:d>` : "never");

export default class BillingCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("billing")
		.setDescription("Subscriptions whose payments are failing")
		.addSubcommand((sub) =>
			sub.setName("list").setDescription("Show subscriptions with failing payments")
		)
		.addSubcommand((sub) =>
			sub
				.setName("rescan")
				.setDescription("Re-check every live subscription against PayPal")
				.addBooleanOption((opt) =>
					opt
						.setName("email-players")
						.setDescription("Also email affected players (default: no)")
						.setRequired(false)
				)
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

		// Channel lock: this output contains payer emails and subscription ids.
		if (interaction.channelId !== PAYMENT_PROCESSOR_CHANNEL_ID) {
			await interaction.reply({
				content: `This command only runs in <#${PAYMENT_PROCESSOR_CHANNEL_ID}>.`,
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
		const sub = chat.options.getSubcommand();
		await interaction.deferReply();

		if (sub === "rescan") {
			await this.rescan(chat);
			return;
		}
		await this.list(chat);
	}

	private async list(interaction: ChatInputCommandInteraction): Promise<void> {
		let data: BillingResponse;
		try {
			const res = await shopFetch("/api/shop/admin/billing-issues");
			if (!res.ok) throw new Error(`shop returned ${res.status}`);
			data = (await res.json()) as BillingResponse;
		} catch (e) {
			await interaction.editReply({
				content: `Couldn't reach the shop: ${(e as Error).message}`,
			});
			return;
		}

		if (!data.openCount) {
			await interaction.editReply({
				content: "No subscriptions are currently failing. Run `/billing rescan` to re-check PayPal.",
			});
			return;
		}

		// Discord caps an embed description at 4096 chars, so cap the list and
		// say so rather than silently truncating.
		const shown = data.issues.slice(0, 20);
		const lines = shown.map((i) => {
			const who = i.discord_id ? `<@${i.discord_id}>` : (i.persona || i.gamertag || "Unknown");
			const emailed = i.player_emailed_at ? "" : "  *(not emailed)*";
			return `**${i.failed_count}x** ${who} — ${i.product_title || "?"} — ${money(i.outstanding_cents)} owed, last paid ${day(i.last_payment_at)}${emailed}`;
		});

		const embed = new EmbedBuilder()
			.setTitle("Subscriptions with failing payments")
			.setDescription(lines.join("\n").slice(0, 4000))
			.setColor(0xf87171)
			.addFields(
				{ name: "Open", value: String(data.openCount), inline: true },
				{ name: "Uncollected", value: money(data.outstandingCents), inline: true }
			)
			.setFooter({
				text:
					data.issues.length > shown.length
						? `Showing ${shown.length} of ${data.issues.length}. Full list on the admin page.`
						: "Full detail on the admin page: /admin/orders",
			})
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });
	}

	private async rescan(interaction: ChatInputCommandInteraction): Promise<void> {
		const emailPlayers = interaction.options.getBoolean("email-players") === true;

		try {
			const res = await shopFetch("/api/shop/admin/billing-issues/rescan", {
				method: "POST",
				body: JSON.stringify({ emailPlayers }),
			});
			if (res.status === 409) {
				await interaction.editReply({ content: "A rescan is already running." });
				return;
			}
			if (!res.ok) throw new Error(`shop returned ${res.status}`);
		} catch (e) {
			await interaction.editReply({
				content: `Couldn't start the rescan: ${(e as Error).message}`,
			});
			return;
		}

		await interaction.editReply({
			content: emailPlayers
				? "Rescanning every live subscription against PayPal. **Affected players will be emailed.** This takes a minute or two…"
				: "Rescanning every live subscription against PayPal. No player emails will be sent. This takes a minute or two…",
		});

		// Poll until it finishes so the channel gets the result rather than
		// leaving someone to guess. Bounded so a stuck rescan can't poll
		// forever, and well inside the 15-minute interaction token.
		const deadline = Date.now() + 5 * 60 * 1000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 5000));
			let data: BillingResponse;
			try {
				const res = await shopFetch("/api/shop/admin/billing-issues");
				if (!res.ok) continue;
				data = (await res.json()) as BillingResponse;
			} catch {
				continue;
			}
			if (data.rescan.running) continue;

			if (data.rescan.error) {
				await interaction.editReply({ content: `Rescan failed: ${data.rescan.error}` });
				return;
			}
			const s = data.rescan.summary;
			const embed = new EmbedBuilder()
				.setTitle("Rescan complete")
				.setColor(data.openCount ? 0xf87171 : 0x4ade80)
				.addFields(
					{ name: "Checked", value: String(s?.scanned ?? 0), inline: true },
					{ name: "Failing", value: String(s?.failing ?? 0), inline: true },
					{ name: "Newly found", value: String(s?.newIssues ?? 0), inline: true },
					{ name: "Resolved", value: String(s?.resolved ?? 0), inline: true },
					{ name: "Lookup errors", value: String(s?.errors ?? 0), inline: true },
					{ name: "Uncollected", value: money(data.outstandingCents), inline: true }
				)
				.setFooter({ text: "Use /billing list for the detail." })
				.setTimestamp();
			await interaction.editReply({ content: "", embeds: [embed] });
			return;
		}

		await interaction.editReply({
			content: "Rescan is taking longer than expected. Check `/billing list` or the admin page shortly.",
		});
	}
}
