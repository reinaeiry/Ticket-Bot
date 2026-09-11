import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	EmbedBuilder,
	GuildMember,
	TextChannel,
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

/**
 * How the approval window reads in player-facing copy. Derived from the
 * constant rather than written out, so changing the window cannot leave the
 * expiry message quietly claiming the old number.
 */
function approvalWindowLabel(): string {
	const minutes = Math.round(RELINK_APPROVAL_TTL_MS / 60_000);
	return minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
}

/** Keeps the customId inside Discord's 100-character limit. */
export const RELINK_TARGET_MAX = 60;

/**
 * Approval messages that have already been answered, Yes or No. Claimed
 * synchronously, before the first await on either branch, so the first press
 * wins and anything racing it -- including a No against a Yes -- is turned
 * away. Previously only Yes took a lock, so a No and a Yes dispatched together
 * could both act and leave the record saying "denied" beside a posted link.
 * The shop still retires any earlier unused token on issue, so at most one link
 * is ever live per player regardless. Entries older than the approval window are
 * dropped on write; by then the buttons are disabled in Discord anyway.
 */
const decided = new Map<string, number>();

function claimDecision(messageId: string): boolean {
	const nowMs = Date.now();
	for (const [id, at] of decided) {
		if (nowMs - at > RELINK_APPROVAL_TTL_MS) decided.delete(id);
	}
	if (decided.has(messageId)) return false;
	decided.set(messageId, nowMs);
	return true;
}

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
			text:
				`Approved re-link for ${target}. Treat this like a password — whoever opens it takes the account. ` +
				`It is posted here, so delete this message once it has been used.`,
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
							`<@${parsed.requesterId}> asked for a re-link for **${parsed.target}**, but nobody answered within ${approvalWindowLabel()}.\nNothing was issued. Run \`/relink\` again if it is still needed.`
						),
				],
				components: [buildApprovalRow(parsed.requesterId, parsed.deadline, parsed.target, true)],
			})
			.catch((e) => console.log(e));
		return;
	}

	// First press wins, Yes or No. Nothing above this line awaits for a Founder,
	// so the claim cannot interleave with another press.
	if (!claimDecision(interaction.message.id)) {
		await interaction
			.reply({ content: "This request has already been answered.", ephemeral: true })
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

		// Owner's call (2026-09-10): the link is posted into the channel the
		// request was made in, rather than DMed. In a ticket that is precisely the
		// right audience - the player who asked and the staff already there - and
		// it removes the "your DMs are closed" dead end. It is still a credential,
		// so it goes out as its OWN message: staff can delete it once it has been
		// used without also deleting the record of who approved what.
		let delivered = false;
		let deliveryNote: string;
		const channel = interaction.channel as TextChannel | null;
		try {
			if (!channel || typeof channel.send !== "function") {
				throw new Error("this channel cannot be posted to");
			}
			await channel.send({
				content: `<@${parsed.requesterId}> - your re-link is ready.`,
				embeds: [linkEmbed(data, parsed.target)],
				// Ping the requester and nobody else.
				allowedMentions: { users: [parsed.requesterId] },
			});
			delivered = true;
			deliveryNote = `Posted in this channel for <@${parsed.requesterId}>.`;
		} catch (e) {
			deliveryNote = `⚠️ Could not post it here (${(e as Error).message.slice(
				0,
				120
			)}). It is in the ephemeral message only you can see — pass it on yourself.`;
		}

		audit(
			"APPROVED",
			parsed,
			founder,
			`platform=${data.platform} expiresAt=${data.expiresAt} posted=${delivered}`
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

		// Only ever shown when posting to the channel failed, so an approved
		// link still reaches a human instead of being silently lost.
		if (!delivered) {
			await interaction
				.followUp({
					content: `I could not post it in the channel. Hand this to <@${parsed.requesterId}> yourself:\n${"```"}${
						data.url
					}${"```"}`,
					ephemeral: true,
				})
				// Never log the error object here: a discord.js API error carries the
				// request body, and the content of this request IS the credential.
				.catch((e) => console.log("[relink-approval] fallback hand-off failed:", (e as Error)?.message));
		}
	} catch (e) {
		// The stack only: an API error object carries its request body.
		console.error("[relink-approval] handler error:", (e as Error)?.stack ?? String(e));
	}
}
