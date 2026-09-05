import { BaseCommand, ExtendedClient } from "../structure";
import {
	buildApprovalRow,
	RELINK_APPROVAL_TTL_MS,
	RELINK_TARGET_MAX,
} from "../utils/relinkApproval";
import {
	ChatInputCommandInteraction,
	CommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
	TextChannel,
} from "discord.js";

// Console sign-in has no ownership proof, so once an account exists the shop
// only admits the browser holding the signed cookie from the original link. A
// player who clears cookies or picks up a different device is locked out of
// their own paid account, and the refusal tells them to open a ticket.
//
// This is the other half of that. It used to be staff-only to run, which meant
// the person who actually needed the link had to get a staff member to type the
// command for them. Now ANYONE can ask — but asking is all the command does.
// The token is minted only when a **Founder** presses Yes on the approval
// message, and it is minted then, not before: see utils/relinkApproval.ts.
//
// Widening who can ask costs nothing precisely because approval, not
// invocation, is the gate that matters.
const SHOP_ADMIN_API_KEY = process.env["SHOP_ADMIN_API_KEY"] || "";

// Opening the command to ~14k members makes it a spam surface in a way it was
// not before. One request per person per minute is invisible to real use and
// stops the obvious abuse; nothing is generated either way.
const REQUEST_COOLDOWN_MS = 60_000;
const lastRequest = new Map<string, number>();

export default class RelinkCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("relink")
		.setDescription("Ask a Founder to issue a console re-link for an account you are locked out of")
		.addStringOption((opt) =>
			opt
				.setName("gamertag")
				.setDescription("The Xbox or PlayStation gamertag (or BattleMetrics player id)")
				.setRequired(true)
		) as unknown as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction): Promise<void> {
		// The approval message has to live in a channel a Founder can reach, and
		// the Founder gate reads guild roles off the presser.
		if (!interaction.inGuild()) {
			await interaction.reply({
				content: "Run this in the server, in your ticket — not in a DM.",
				ephemeral: true,
			});
			return;
		}

		// Fail on a missing key here rather than after a Founder has approved:
		// approving something that then cannot be issued wastes their time.
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
		// The request survives a bot restart by living entirely in the button
		// customId, which Discord caps at 100 characters. Real gamertags are 16
		// at most, so this only ever rejects junk.
		if (raw.length > RELINK_TARGET_MAX || raw.includes("|") || /\s{2,}|[\r\n]/.test(raw)) {
			await interaction.reply({
				content: "That doesn't look like a gamertag. Give me just the gamertag, or their BattleMetrics player id.",
				ephemeral: true,
			});
			return;
		}

		const now = Date.now();
		const previous = lastRequest.get(interaction.user.id) ?? 0;
		if (now - previous < REQUEST_COOLDOWN_MS) {
			await interaction.reply({
				content: `Slow down — you can ask again <t:${Math.ceil(
					(previous + REQUEST_COOLDOWN_MS) / 1000
				)}:R>.`,
				ephemeral: true,
			});
			return;
		}

		const channel = interaction.channel as TextChannel | null;
		if (!channel || typeof channel.send !== "function") {
			await interaction.reply({
				content: "I can't post the approval request in this channel.",
				ephemeral: true,
			});
			return;
		}

		// Acknowledge before posting. Discord kills an unacknowledged interaction
		// after 3 seconds, and channel.send() can sit longer than that behind a
		// rate limit — which would leave the approval message posted and the
		// requester told nothing.
		await interaction.deferReply({ ephemeral: true });

		const deadline = Math.floor((now + RELINK_APPROVAL_TTL_MS) / 1000);

		const embed = new EmbedBuilder()
			.setTitle("Console re-link — waiting on a Founder")
			.setColor(0xf1c40f)
			.setDescription(
				[
					`<@${interaction.user.id}> is asking for a re-link link for **${raw}**.`,
					"",
					"**Nothing has been generated.** A Founder has to press Yes first — only then does a link exist, and it goes to the person who asked, by DM.",
				].join("\n")
			)
			.addFields(
				{ name: "Requested by", value: `<@${interaction.user.id}>`, inline: true },
				{ name: "Target", value: `\`${raw}\``, inline: true },
				{ name: "Request expires", value: `<t:${deadline}:R>`, inline: true }
			)
			.setFooter({
				text: "Founders only. Check they are who they say they are before approving — a gamertag is public.",
			});

		try {
			await channel.send({
				embeds: [embed],
				components: [buildApprovalRow(interaction.user.id, deadline, raw)],
				// The embed mentions the requester for the record, not to ping the
				// channel; anyone can trigger this now.
				allowedMentions: { parse: [] },
			});
		} catch (e) {
			await interaction.editReply({
				content: `I couldn't post the approval request here: ${(e as Error).message}`,
			});
			return;
		}

		lastRequest.set(interaction.user.id, now);

		await interaction.editReply({
			content:
				`Asked. A Founder has to approve it — nothing exists until they do.\n` +
				`If they approve, **I'll DM you the link**, so make sure your DMs from this server are open.`,
		});
	}
}
