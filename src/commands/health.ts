import { BaseCommand, ExtendedClient } from "../structure";
import { hasPanelAccess } from "../utils/staffGate";
import { APIEmbed, CommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";

// Checks the shop now and answers with the same card #Payment-Processor gets every
// morning at 09:00 UTC. The shop builds it (tools/healthReport.js) and changes nothing
// for it: Discord roles a player is missing are listed, not given back, and no card
// goes to the webhook. The deep check takes about a minute, so the shop runs it
// detached and this polls, the way /billing rescan does. Two people asking at once
// share one check.
const SHOP_BASE_URL = process.env["SHOP_BASE_URL"] || "https://reforgedz.net";
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

// #Payment-Processor. Same lock as /billing: the card carries money totals and player names.
const PAYMENT_PROCESSOR_CHANNEL_ID =
	process.env["PAYMENT_PROCESSOR_CHANNEL_ID"] || "1481277655826305204";

interface HealthCheckState {
	started?: boolean;
	running: boolean;
	startedAt: number | null;
	finishedAt: number | null;
	body: { embeds?: APIEmbed[] } | null;
	error: string | null;
}

async function shopFetch(path: string, init?: RequestInit) {
	return fetch(`${SHOP_BASE_URL}${path}`, {
		...init,
		// Bounds every call, so the poll loop's deadline holds whatever the URL.
		signal: init?.signal ?? AbortSignal.timeout(15_000),
		headers: {
			"Content-Type": "application/json",
			"x-shop-admin-key": SHOP_ADMIN_API_KEY,
			...(init?.headers ?? {}),
		},
	});
}

export default class HealthCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("health")
		.setDescription("Check the shop now: the same card the channel gets at 09:00 UTC");

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction): Promise<void> {
		const member = interaction.member as GuildMember | null;
		// Same gate as /billing.
		if (!hasPanelAccess(this.client, member, "shop-support")) {
			await interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true,
			});
			return;
		}

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

		await interaction.deferReply();

		let mine = 0;
		try {
			const res = await shopFetch("/api/shop/admin/health-check", { method: "POST", body: "{}" });
			if (!res.ok) throw new Error(`shop returned ${res.status}`);
			const state = (await res.json()) as HealthCheckState;
			mine = state.startedAt ?? 0;
		} catch (e) {
			await interaction.editReply({
				content: `Couldn't start the health check: ${(e as Error).message}`,
			});
			return;
		}

		await interaction.editReply({
			content: "Checking every part of the shop. This takes about a minute…",
		});

		// Wait for this check, or a newer one, to finish. Bounded well inside the
		// 15-minute interaction token. A shop restart mid-check loses it: the state
		// comes back empty and this runs out the clock, then says so.
		const deadline = Date.now() + 5 * 60 * 1000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 5000));
			let state: HealthCheckState;
			try {
				const res = await shopFetch("/api/shop/admin/health-check");
				if (!res.ok) continue;
				state = (await res.json()) as HealthCheckState;
			} catch {
				continue;
			}
			if (state.running || (state.startedAt ?? 0) < mine) continue;

			const embeds = state.body?.embeds ?? [];
			if (state.error || !embeds.length) {
				await interaction.editReply({
					content: `The health check failed: ${state.error || "the shop sent no card back"}`,
				});
				return;
			}
			await interaction.editReply({ content: "", embeds, allowedMentions: { parse: [] } });
			return;
		}

		await interaction.editReply({
			content: "The health check is taking longer than expected. Try `/health` again in a few minutes, or read the 09:00 UTC card.",
		});
	}
}
