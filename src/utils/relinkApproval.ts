import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	EmbedBuilder,
	GuildMember,
} from "discord.js";
import { ExtendedClient } from "../structure";
import { hasPanelAccessStrict } from "./staffGate";

// The approval half of /relink.
//
// /relink is open to everyone, because the person who needs the link is the one
// already sitting in the ticket, and making them find a Founder to type the
// command was the whole friction. But the link IS the account: whoever opens it
// takes over the console lock and with it the purchase history. So the command
// only ever *asks*. Nothing is minted until a Founder presses Yes — there is
// deliberately no pre-generated token sitting around waiting to be handed out,
// because a token that exists is a token that can leak.
//
// The shop still owns the tokens (single use, SHA-256 stored, 24h TTL, atomic
// claim); this remains a thin remote control over its admin API. See the shop's
// server.js `/api/shop/admin/console/relink`.

const SHOP_BASE_URL = process.env["SHOP_BASE_URL"] || "https://reforgedz.net";
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

// customId layout: rlk|<y|n>|<requesterId>|<deadlineUnix>|<target>
// All of the state lives in the customId on purpose. An in-memory map would go
// empty on the next boot and leave a channel full of buttons that answer
// "unknown request" — and this bot reboots on every deploy.
const PREFIX = "rlk";
const SEP = "|";

/** How long the Yes/No buttons stay answerable. Matches the link TTL. */
export const RELINK_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Keeps the customId inside Discord's 100-character limit. */
export const RELINK_TARGET_MAX = 60;

/**
 * Messages currently being acted on, so two Founders pressing Yes in the same
 * instant cannot both reach the mint endpoint. Best-effort only — the real
 * guarantee is the shop, which retires any earlier unused token when it issues
 * a new one, so at most one link is ever live for a player.
 */
const inFlight = new Set<string>();

export interface RelinkResponse {
	ok: boolean;
	url: string;
	expiresAt: number;
	expiresInMinutes: number;
	expiresInHours?: number;
	gamertag: string;
	platform: string;
}

interface ParsedApproval {
	approve: boolean;
	requesterId: string;
	deadline: number;
	target: string;
}

export function isRelinkApprovalButton(customId: string): boolean {
	return customId.startsWith(PREFIX + SEP);
}

function parseApproval(customId: string): ParsedApproval | null {
	const parts = customId.split(SEP);
	if (parts.length < 5 || parts[0] !== PREFIX) return null;
	if (parts[1] !== "y" && parts[1] !== "n") return null;
	const deadline = Number(parts[3]);
	if (!Number.isFinite(deadline)) return null;
	// The target is last and is joined back up, so a stray separator can never
	// truncate it silently.
	const target = parts.slice(4).join(SEP);
	if (!parts[2] || !target) return null;
	return { approve: parts[1] === "y", requesterId: parts[2], deadline, target };
}

export function buildApprovalRow(
	requesterId: string,
	deadline: number,
	target: string,
	disabled = false
): ActionRowBuilder<ButtonBuilder> {
	const tail = `${SEP}${requesterId}${SEP}${deadline}${SEP}${target}`;
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${PREFIX}${SEP}y${tail}`)
			.setLabel("Yes — issue the link")
			.setStyle(ButtonStyle.Success)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${PREFIX}${SEP}n${tail}`)
			.setLabel("No")
			.setStyle(ButtonStyle.Danger)
			.setDisabled(disabled)
	);
}

/** One line per decision, so the audit survives even if the channel is deleted. */
function audit(
	verdict: string,
	p: ParsedApproval,
	founder: { id: string; tag: string },
	extra = ""
): void {
	console.log(
		`[relink-approval] ${verdict} target="${p.target}" requestedBy=${p.requesterId} ` +
			`by=${founder.tag}(${founder.id}) at=${new Date().toISOString()}${extra ? " " + extra : ""}`
	);
}

async function mintRelink(target: string): Promise<{ data?: RelinkResponse; error?: string }> {
	const body = /^\d+$/.test(target) ? { bmPlayerId: target } : { gamertag: target };
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
			return { error: err.error ? `Shop said: ${err.error}` : `The shop returned ${res.status}.` };
		}
		return { data: (await res.json()) as RelinkResponse };
	} catch (e) {
		return { error: `Couldn't reach the shop: ${(e as Error).message}` };
	}
}

function linkEmbed(data: RelinkResponse, target: string): EmbedBuilder {
	return new EmbedBuilder()
		.setTitle("Console re-link")
		.setColor(0x2ecc71)
		.setDescription(
			[
				`**${data.gamertag}** · ${data.platform.toUpperCase()}`,
				"",
				"Open this **on the device you want to stay signed in on**.",
				"",
				"```" + data.url + "```",
			].join("\n")
		)
		.addFields(
			{ name: "Expires", value: `<t:${data.expiresAt}:R>`, inline: true },
			{ name: "Uses", value: "One, then it is dead", inline: true }
		)
		.setFooter({
			text: `Approved re-link for ${target}. Treat this like a password — whoever opens it takes the account.`,
		});
}

export async function handleRelinkApproval(
	interaction: ButtonInteraction,
	client: ExtendedClient
): Promise<void> {
	const parsed = parseApproval(interaction.customId);
	if (!parsed) return;

	const member = interaction.member as GuildMember | null;

	// Founder only, and deliberately the STRICT gate: the global staff role
	// (Global Admin) is excluded, exactly as /refund does. A non-Founder press
	// changes nothing at all — no mint, no edit, no audit line.
	if (!hasPanelAccessStrict(client, member, "shop-support")) {
		await interaction
			.reply({ content: "Only a Founder can approve a re-link request.", ephemeral: true })
			.catch((e) => console.log(e));
		return;
	}

	const founder = { id: interaction.user.id, tag: interaction.user.tag };
	const now = Math.floor(Date.now() / 1000);

	if (now > parsed.deadline) {
		audit("EXPIRED", parsed, founder);
		await interaction
			.update({
				embeds: [
					new EmbedBuilder()
						.setTitle("Console re-link request — expired")
						.setColor(0x95a5a6)
						.setDescription(
							`<@${parsed.requesterId}> asked for a re-link for **${parsed.target}**, but nobody answered within 24 hours.\nNothing was issued. Run \`/relink\` again if it is still needed.`
						),
				],
				components: [buildApprovalRow(parsed.requesterId, parsed.deadline, parsed.target, true)],
			})
			.catch((e) => console.log(e));
		return;
	}

	if (inFlight.has(interaction.message.id)) {
		await interaction
			.reply({ content: "Someone is already answering this request.", ephemeral: true })
			.catch((e) => console.log(e));
		return;
	}

	const disabledRow = buildApprovalRow(parsed.requesterId, parsed.deadline, parsed.target, true);

	if (!parsed.approve) {
		audit("DENIED", parsed, founder);
		await interaction
			.update({
				embeds: [
					new EmbedBuilder()
						.setTitle("Console re-link denied")
						.setColor(0xe74c3c)
						.setDescription("No link was generated.")
						.addFields(
							{ name: "Requested by", value: `<@${parsed.requesterId}>`, inline: true },
							{ name: "Target", value: `\`${parsed.target}\``, inline: true },
							{ name: "Denied by", value: `<@${founder.id}>`, inline: true },
							{ name: "When", value: `<t:${now}:f>`, inline: false }
						),
				],
				components: [disabledRow],
			})
			.catch((e) => console.log(e));
		return;
	}

	inFlight.add(interaction.message.id);
	try {
		// Disable the buttons FIRST. The token does not exist yet, so a second
		// press landing here would mint a second one; taking the buttons away
		// before the shop call closes that window.
		await interaction.update({
			embeds: [
				new EmbedBuilder()
					.setTitle("Console re-link approved")
					.setColor(0xf1c40f)
					.setDescription(`Approved by <@${founder.id}> — asking the shop for a link…`),
			],
			components: [disabledRow],
		});

		if (!SHOP_ADMIN_API_KEY) {
			audit("APPROVED-FAILED", parsed, founder, "reason=no-api-key");
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle("Console re-link failed")
						.setColor(0xe67e22)
						.setDescription(
							"SHOP_ADMIN_API_KEY is not set on the bot, so it can't reach the shop. Nothing was issued."
						),
				],
				components: [disabledRow],
			});
			return;
		}

		const { data, error } = await mintRelink(parsed.target);
		if (!data) {
			audit("APPROVED-FAILED", parsed, founder, `reason=${JSON.stringify(error ?? "unknown")}`);
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle("Console re-link failed")
						.setColor(0xe67e22)
						.setDescription("Approved, but no link could be issued — so nothing exists.")
						.addFields(
							{ name: "Requested by", value: `<@${parsed.requesterId}>`, inline: true },
							{ name: "Target", value: `\`${parsed.target}\``, inline: true },
							{ name: "Approved by", value: `<@${founder.id}>`, inline: true },
							{ name: "Shop said", value: (error ?? "Unknown error").slice(0, 900), inline: false }
						),
				],
				components: [disabledRow],
			});
			return;
		}

		// The link goes to the requester by DM, never into the channel. Everyone
		// who can read a shop ticket is trusted, but the transcript of it
		// outlives the ticket and is served from the archive.
		let delivered = false;
		let deliveryNote: string;
		try {
			const requester = await client.users.fetch(parsed.requesterId);
			await requester.send({ embeds: [linkEmbed(data, parsed.target)] });
			delivered = true;
			deliveryNote = `Sent to <@${parsed.requesterId}> by DM.`;
		} catch (e) {
			deliveryNote = `⚠️ Could not DM <@${parsed.requesterId}> (${(e as Error).message.slice(
				0,
				120
			)}). It is in the ephemeral message only you can see — pass it on yourself.`;
		}

		audit(
			"APPROVED",
			parsed,
			founder,
			`platform=${data.platform} expiresAt=${data.expiresAt} dm=${delivered}`
		);

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle("Console re-link approved")
					.setColor(delivered ? 0x2ecc71 : 0xf1c40f)
					.setDescription(deliveryNote)
					.addFields(
						{ name: "Requested by", value: `<@${parsed.requesterId}>`, inline: true },
						{
							name: "Target",
							value: `${data.gamertag} (${data.platform.toUpperCase()})`,
							inline: true,
						},
						{ name: "Approved by", value: `<@${founder.id}>`, inline: true },
						{ name: "When", value: `<t:${now}:f>`, inline: true },
						{ name: "Link expires", value: `<t:${data.expiresAt}:R> — or on first use`, inline: true }
					),
			],
			components: [disabledRow],
		});

		// Only ever shown when the DM bounced, so the link still reaches a human
		// without being written into the channel.
		if (!delivered) {
			await interaction
				.followUp({
					content: `Their DMs are closed. Hand this to <@${parsed.requesterId}> yourself:\n${"```"}${
						data.url
					}${"```"}`,
					ephemeral: true,
				})
				.catch((e) => console.log(e));
		}
	} catch (e) {
		console.error("[relink-approval] handler error:", e);
	} finally {
		inFlight.delete(interaction.message.id);
	}
}
