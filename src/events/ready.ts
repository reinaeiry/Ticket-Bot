import axios from "axios";
import {ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ColorResolvable, EmbedBuilder, Message} from "discord.js";
import {BaseEvent, ExtendedClient, SponsorType} from "../structure";
import { resumePendingDeletes } from "../utils/pendingDeletes";

/*
Copyright 2023 Sayrix (github.com/Sayrix)

Licensed under the Creative Commons Attribution 4.0 International
please check https://creativecommons.org/licenses/by/4.0 for more informations.
*/

export default class ReadyEvent extends BaseEvent {
	constructor(client: ExtendedClient) {
		super(client);
	}

	public async execute()  {
		if (!this.client.config.guildId) {
			console.log("⚠️⚠️⚠️ Please add the guild id in the config.jsonc file. ⚠️⚠️⚠️");
			process.exit(0);
		}

		await this.client.guilds.fetch(this.client.config.guildId);
		await this.client.guilds.cache.get(this.client.config.guildId)?.members.fetch();
		if (!this.client.guilds.cache.get(this.client.config.guildId)?.members.me?.permissions.has("Administrator")) {
			console.log("\n⚠️⚠️⚠️ I don't have the Administrator permission, to prevent any issues please add the Administrator permission to me. ⚠️⚠️⚠️");
			process.exit(0);
		}

		const embedMessageId = (await this.client.prisma.config.findUnique({
			where: {
				key: "openTicketMessageId",
			}
		}))?.value;
		await this.client.channels.fetch(this.client.config.openTicketChannelId).catch(() => {
			console.error("The channel to open tickets is not found!");
			process.exit(0);
		});
		const openTicketChannel = await this.client.channels.cache.get(this.client.config.openTicketChannelId);
		if (!openTicketChannel) {
			console.error("The channel to open tickets is not found!");
			process.exit(0);
		}

		if (!openTicketChannel.isTextBased()) {
			console.error("The channel to open tickets is not a channel!");
			process.exit(0);
		}
		const locale = this.client.locales;
		const footer = locale.getSubValue("embeds", "openTicket", "footer", "text");
		const embed = new EmbedBuilder({
			...locale.getSubRawValue("embeds.openTicket") as object,
			color: 0,
		})
			.setColor(
				locale.getNoErrorSubValue("embeds", "openTicket", "color") as ColorResolvable | undefined ??
				this.client.config.mainColor
			)
			.setFooter({
				text: footer,
				iconURL: locale.getNoErrorSubValue("embeds.openTicket.footer.iconURL")
			});

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId("openTicket").setLabel(this.client.locales.getSubValue("other", "openTicketButtonMSG")).setStyle(ButtonStyle.Primary)
		);

		try {
			// Fetch Message object and return undefined if not found
			const msg = embedMessageId ? await (()=> new Promise<Message | undefined>((res)=> {
				openTicketChannel?.messages?.fetch(embedMessageId)
					.then(msg=>res(msg))
					.catch(()=>res(undefined));
			}))() : undefined;
			
			if (msg && msg.id) {
				msg.edit({
					embeds: [embed],
					components: [row]
				});
			} else {
				const channel = this.client.channels.cache.get(this.client.config.openTicketChannelId);
				if(channel?.type !== ChannelType.GuildText) 
					return console.error("Invalid openTicketChannelId");
				channel.send({
					embeds: [embed],
					components: [row]
				}).then((rMsg) => {
					this.client.prisma.config.upsert({
						create: {
							key: "openTicketMessageId",
							value: rMsg.id
						},
						update: {
							value: rMsg.id
						},
						where: {
							key: "openTicketMessageId"
						}
					}).then(); // I need .then() for it to execute?!?!??
				});
			}
		} catch (e) {
			console.error(e);
		}


		await this.client.loadRuntimeConfig();
		await resumePendingDeletes(this.client);

		this.setStatus();
		setInterval(()=>this.setStatus(), 9e5); // 15 minutes

		console.log(`\x1b[0m🚀  Bot ready! Logged in as \x1b[37;46;1m${this.client.user?.tag}\x1b[0m`);

		this.client.deployCommands();
	}

	private setStatus(): void {
		if (this.client.config.status) {
			if (!this.client.config.status.enabled) return;

			let type = 0;
			switch(this.client.config.status.type) {
			case "PLAYING":
				type = 0;
				break;
			case "STREAMING":
				type = 1;
				break;
			case "LISTENING":
				type = 2;
				break;
			case "WATCHING":
				type = 3;
				break;
			case "CUSTOM":
				type = 4;
				break;
			case "COMPETING":
				type = 5;
				break;
			}

			if (this.client.config.status.type && this.client.config.status.text) {
				// If the user just want to set the status but not the activity
				const url = this.client.config.status.url;
				this.client.user?.setPresence({
					activities: [{ name: this.client.config.status.text, type: type, url: (url && url.trim() !== "") ? url : undefined }],
					status: this.client.config.status.status,
				});
			}
			this.client.user?.setStatus(this.client.config.status.status);
		}
	}

}

/*
Copyright 2023 Sayrix (github.com/Sayrix)

Licensed under the Creative Commons Attribution 4.0 International
please check https://creativecommons.org/licenses/by/4.0 for more informations.
*/
