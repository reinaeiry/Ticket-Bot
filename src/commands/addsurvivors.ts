import { BaseCommand, ExtendedClient } from "../structure";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CommandInteraction,
	ComponentType,
	GuildMember,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextChannel,
} from "discord.js";

const SURVIVOR_ROLE = "1538956957430448130";

// The interaction token expires 15 minutes after the command was invoked, and a
// guild this size can take hours to work through because Discord rate limits role
// writes. Once we get near the edge, progress and the final summary move to plain
// channel messages instead of editReply — throttled hard, because a run of this
// length would otherwise dump well over a hundred messages into the channel.
const INTERACTION_WINDOW_MS = 14 * 60 * 1000;
const CHANNEL_PROGRESS_MS = 15 * 60 * 1000;
const PROGRESS_EVERY = 100;

export default class AddSurvivorsCommand extends BaseCommand {
	public static data = new SlashCommandBuilder()
		.setName("addsurvivors")
		.setDescription("Give the Survivor role to every member who doesn't already have it") as SlashCommandBuilder;

	constructor(client: ExtendedClient) {
		super(client);
	}

	async execute(interaction: CommandInteraction) {
		const invoker = interaction.member as GuildMember | null;
		if (!invoker?.permissions.has(PermissionFlagsBits.Administrator)) {
			return interaction.reply({ content: "Administrator required.", ephemeral: true });
		}
		const guild = interaction.guild;
		if (!guild) return interaction.reply({ content: "Guild only.", ephemeral: true });

		const role = guild.roles.cache.get(SURVIVOR_ROLE) ?? (await guild.roles.fetch(SURVIVOR_ROLE).catch(() => null));
		if (!role) return interaction.reply({ content: `Role \`${SURVIVOR_ROLE}\` was not found in this guild.`, ephemeral: true });

		// Role hierarchy is not bypassed by Administrator — bail out with a clear
		// message rather than failing once per member.
		const me = guild.members.me;
		if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
			return interaction.reply({
				content: `I cannot assign **${role.name}** — I need Manage Roles and a role positioned above it.`,
				ephemeral: true,
			});
		}

		await interaction.deferReply({ ephemeral: true });

		const all = await guild.members.fetch();
		const humans = all.filter((m) => !m.user.bot);
		const targets = humans.filter((m) => !m.roles.cache.has(SURVIVOR_ROLE));

		if (targets.size === 0) {
			await interaction.editReply({
				content: `Nothing to do — all ${humans.size} non-bot members already have **${role.name}**.`,
			});
			return;
		}

		const confirmId = `addsurvivors_go_${interaction.id}`;
		const cancelId = `addsurvivors_no_${interaction.id}`;
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(confirmId).setLabel(`Assign to ${targets.size}`).setStyle(ButtonStyle.Danger),
			new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
		);

		const prompt = await interaction.editReply({
			content: `**${targets.size}** of ${humans.size} non-bot members are missing **${role.name}**. Discord rate limits role writes, so this can take a long time. Proceed?`,
			components: [row],
		});

		const press = await prompt
			.awaitMessageComponent({
				componentType: ComponentType.Button,
				filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
				time: 60_000,
			})
			.catch(() => null);

		if (!press || press.customId === cancelId) {
			await interaction.editReply({
				content: press ? "Cancelled — nothing was changed." : "Timed out — nothing was changed.",
				components: [],
			});
			return;
		}

		await press.deferUpdate().catch((e) => console.log("addsurvivors deferUpdate:", e));
		await interaction.editReply({ content: `Assigning **${role.name}** to ${targets.size} members…`, components: [] });

		const startedAt = Date.now();
		let assigned = 0;
		let skipped = 0;
		let failed = 0;
		let processed = 0;

		let lastChannelPost = 0;
		const report = async (text: string, final = false) => {
			if (Date.now() - startedAt < INTERACTION_WINDOW_MS) {
				await interaction.editReply({ content: text }).catch((e) => console.log("addsurvivors editReply:", e));
				return;
			}
			if (!final && Date.now() - lastChannelPost < CHANNEL_PROGRESS_MS) return;
			lastChannelPost = Date.now();
			await (interaction.channel as TextChannel | null)
				?.send({ content: `${interaction.user} ${text}` })
				.catch((e) => console.log("addsurvivors channel report:", e));
		};

		for (const m of targets.values()) {
			processed++;

			// A member may have picked the role up by other means since the fetch.
			if (m.roles.cache.has(SURVIVOR_ROLE)) {
				skipped++;
			} else {
				try {
					await m.roles.add(SURVIVOR_ROLE, `/addsurvivors by ${interaction.user.tag}`);
					assigned++;
				} catch (e) {
					failed++;
					console.log(`addsurvivors failed for ${m.id}:`, e);
				}
			}

			if (processed % PROGRESS_EVERY === 0) {
				await report(
					`Assigning **${role.name}**… ${processed}/${targets.size} processed, ${assigned} added, ${failed} failed.`,
				);
			}
		}

		await report(
			`Done. Added **${role.name}** to **${assigned}** member(s). Already had it: ${skipped}. Failed: ${failed}. Processed: ${processed}/${targets.size}.`,
			true,
		);
	}
}
