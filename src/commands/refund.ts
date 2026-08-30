import { BaseCommand, ExtendedClient } from "../structure";
import { hasPanelAccessStrict } from "../utils/staffGate";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	CommandInteraction,
	ComponentType,
	EmbedBuilder,
	GuildMember,
	SlashCommandBuilder,
} from "discord.js";

// Refund the player's most recent month and make sure they are not billed again.
//
// The shop owns the money. This resolves a GUID to exactly one order via a
// read-only preview, shows the operator everything, and then calls the SAME
// audited endpoint the admin page uses (/api/shop/admin/revoke with refund).
// That endpoint refunds the capture, cancels the PayPal subscription, marks the
// order refunded, strips the Discord role, and re-syncs the game servers so
// in-game priority queue goes with it. We deliberately do not reimplement any
// of that here.
const SHOP_BASE_URL = process.env["SHOP_BASE_URL"] || "https://reforgedz.net";
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

// #Payment-Processor. Same lock as /billing.
const PAYMENT_PROCESSOR_CHANNEL_ID =
	process.env["PAYMENT_PROCESSOR_CHANNEL_ID"] || "1481277655826305204";

interface Preview {
	ok: boolean;
	player: {
		persona: string | null; gamertag: string | null; platform: string;
		steamId: string; guid: string; discordId: string | null;
	};
	target: {
		orderId: number; product: string; amountCents: number; currency: string;
		serverId: string | null; paidAt: number | null; coversUntil: number | null;
		stillInPaidPeriod: boolean; captureId: string;
	} | null;
	refundable: boolean;
	reason: string | null;
	subscription: {
		id: string; status: string; alreadyCancelled?: boolean;
		lastPayment?: { amount: string; at: string } | null;
		nextBilling?: string | null; failedPayments?: number | null; error?: string;
	} | null;
	orderHistory: { id: number; status: string; product: string; amountCents: number; paidAt: number | null; coversUntil: number | null }[];
}

const money = (cents: number, cur = "USD") =>
	`${cur === "USD" ? "$" : ""}${((cents || 0) / 100).toFixed(2)}${cur === "USD" ? "" : " " + cur}`;
const day = (unix: number | null | undefined) => (unix ? `<t:${unix}:D>` : "—");

async function shopFetch(path: string, init?: RequestInit) {
	return fetch(`${SHOP_BASE_URL}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			"x-shop-admin-key": SHOP_ADMIN_API_KEY,
			...(init?.headers ?? {}),
		},
	});
}

export default class RefundCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("refund")
		.setDescription("Refund a player's most recent month and stop their subscription")
		.addStringOption((opt) =>
			opt
				.setName("guid")
				.setDescription("Their in-game GUID (Bohemia identity id)")
				.setRequired(true)
		) as unknown as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction): Promise<void> {
		const member = interaction.member as GuildMember | null;

		// Founder only. Deliberately stricter than /relink: this one moves money,
		// so the global staff role (Global Admin) is excluded.
		if (!hasPanelAccessStrict(this.client, member, "shop-support")) {
			await interaction.reply({
				content: "Only Founders can issue refunds.",
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

		const chat = interaction as ChatInputCommandInteraction;
		const guid = (chat.options.getString("guid") || "").trim();

		// Ephemeral throughout. The public record is posted automatically by the
		// shop's existing order_revoked webhook into this same channel, so there
		// is an audit trail without payer detail sitting in the decision step.
		await interaction.deferReply({ ephemeral: true });

		let pv: Preview;
		try {
			const res = await shopFetch(`/api/shop/admin/refund-preview?guid=${encodeURIComponent(guid)}`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				const b = body as { error?: string; accounts?: { persona: string; platform: string; steamId: string }[] };
				let msg = b.error || `The shop returned ${res.status}.`;
				if (b.accounts?.length) {
					msg += "\n" + b.accounts.map((a) => `• ${a.persona} (${a.platform}) \`${a.steamId}\``).join("\n");
				}
				await interaction.editReply({ content: msg });
				return;
			}
			pv = body as Preview;
		} catch (e) {
			await interaction.editReply({ content: `Couldn't reach the shop: ${(e as Error).message}` });
			return;
		}

		const p = pv.player;
		const who = p.persona || p.gamertag || p.steamId;

		if (!pv.refundable || !pv.target) {
			await interaction.editReply({
				content: `**${who}** cannot be refunded automatically.\n${pv.reason || "No refundable order."}`,
			});
			return;
		}

		const t = pv.target;
		const sub = pv.subscription;

		const embed = new EmbedBuilder()
			.setTitle("Confirm refund")
			.setColor(0xe67e22)
			.addFields(
				{
					name: "Player",
					value: [
						`**${who}** (${p.platform})`,
						p.discordId ? `Discord: <@${p.discordId}>` : "Discord: not linked",
						`GUID: \`${p.guid}\``,
					].join("\n"),
					inline: false,
				},
				{
					name: "Refunding",
					value: [
						`**${money(t.amountCents, t.currency)}** — ${t.product}`,
						`Order #${t.orderId}${t.serverId ? ` · ${t.serverId.toUpperCase()}` : ""}`,
						`Paid ${day(t.paidAt)} · covers until ${day(t.coversUntil)}`,
						t.stillInPaidPeriod ? "They are still inside that paid period." : "That period has already ended.",
					].join("\n"),
					inline: false,
				},
				{
					name: "Subscription",
					value: sub
						? [
								`\`${sub.id}\``,
								`Status: **${sub.status}**${sub.alreadyCancelled ? " (already cancelled)" : ""}`,
								sub.lastPayment ? `Last payment: $${sub.lastPayment.amount} on <t:${Math.floor(Date.parse(sub.lastPayment.at) / 1000)}:D>` : "",
								sub.nextBilling ? `Next billing: <t:${Math.floor(Date.parse(sub.nextBilling) / 1000)}:D>` : "Next billing: none",
						  ].filter(Boolean).join("\n")
						: "No subscription attached to this order (one-off purchase).",
					inline: false,
				},
				{
					name: "This will",
					value: [
						`• Refund ${money(t.amountCents, t.currency)} to their PayPal`,
						sub && !sub.alreadyCancelled ? "• Cancel the subscription so they are not charged again" : "• Leave the subscription alone (already cancelled)",
						"• Remove their in-game priority queue",
						"• Remove their paid Discord role",
						"• Email them a refund confirmation",
					].join("\n"),
					inline: false,
				}
			)
			.setFooter({ text: "Refunds cannot be undone. Expires in 60 seconds." });

		if (pv.orderHistory.length > 1) {
			embed.addFields({
				name: "Recent orders",
				value: pv.orderHistory
					.map((o) => `#${o.id} ${o.status} ${money(o.amountCents, t.currency)} ${o.product} · paid ${day(o.paidAt)}`)
					.join("\n")
					.slice(0, 1000),
				inline: false,
			});
		}

		const token = `${interaction.id}`;
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`refund_go_${token}`).setLabel(`Refund ${money(t.amountCents, t.currency)}`).setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId(`refund_no_${token}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
		);

		const msg = await interaction.editReply({ embeds: [embed], components: [row] });

		let press;
		try {
			press = await (msg as any).awaitMessageComponent({
				componentType: ComponentType.Button,
				time: 60_000,
				filter: (i: any) => i.user.id === interaction.user.id,
			});
		} catch {
			await interaction.editReply({ content: "Timed out, nothing was refunded.", embeds: [], components: [] });
			return;
		}

		if (press.customId === `refund_no_${token}`) {
			await press.update({ content: "Cancelled, nothing was refunded.", embeds: [], components: [] });
			return;
		}

		await press.update({ content: "Refunding…", embeds: [], components: [] });

		let result: { ok?: boolean; refundedCents?: number; subscriptionCancelled?: boolean; subscriptionCancelError?: string | null; error?: string };
		try {
			const res = await shopFetch("/api/shop/admin/revoke", {
				method: "POST",
				body: JSON.stringify({ orderId: t.orderId, refund: true }),
			});
			result = (await res.json().catch(() => ({}))) as typeof result;
			if (!res.ok) {
				await interaction.editReply({ content: `Refund failed: ${result.error || res.status}` });
				return;
			}
		} catch (e) {
			await interaction.editReply({ content: `Refund failed: ${(e as Error).message}` });
			return;
		}

		// Verify against PayPal rather than trusting the write. Same read-only
		// preview, called again: it re-reads the live subscription status.
		let verified = "not checked";
		try {
			const res = await shopFetch(`/api/shop/admin/refund-preview?guid=${encodeURIComponent(guid)}`);
			if (res.ok) {
				const after = (await res.json()) as Preview;
				verified = after.subscription ? after.subscription.status : "no subscription";
			}
		} catch { /* verification is best-effort; the refund already happened */ }

		const okSub = !sub || verified === "CANCELLED" || verified === "no subscription";
		const done = new EmbedBuilder()
			.setTitle("Refunded")
			.setColor(okSub ? 0x2ecc71 : 0xf1c40f)
			.setDescription(
				[
					`**${who}** — order #${t.orderId}`,
					`Refunded **${money(result.refundedCents || t.amountCents, t.currency)}**`,
					`Subscription now: **${verified}**`,
					okSub
						? "They will not be charged again."
						: "⚠️ Could not confirm the subscription is cancelled. Check it in PayPal before closing the ticket.",
					"In-game priority queue and the paid Discord role have been removed.",
				].join("\n")
			);
		if (result.subscriptionCancelError) {
			done.addFields({ name: "Subscription cancel reported an error", value: String(result.subscriptionCancelError).slice(0, 500) });
		}

		await interaction.editReply({ content: "", embeds: [done], components: [] });
	}
}
