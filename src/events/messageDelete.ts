import { Message, PartialMessage } from "discord.js";
import { ExtendedClient } from "../structure";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ticketBus = require("../../web/lib/ticketBus");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSupportedCode, permKeyForCode } = require("../../web/lib/ticketCategories");

// Tell the admin SPA to drop the deleted message from the ticket view.
// We don't need the full message body — just the id + channel.
export default class MessageDeleteEvent {
	private readonly client: ExtendedClient;
	constructor(client: ExtendedClient) {
		this.client = client;
	}
	public async execute(message: Message | PartialMessage): Promise<void> {
		try {
			if (!message.channelId) return;
			const ticket = await this.client.prisma.tickets.findUnique({
				where: { channelid: message.channelId }
			});
			if (!ticket || ticket.closedat) return;
			const cat = JSON.parse(ticket.category) as { codeName?: string };
			if (!cat?.codeName || !isSupportedCode(cat.codeName)) return;
			ticketBus.publish({
				type: "ticket.message.delete",
				channelId: message.channelId,
				permKey: permKeyForCode(cat.codeName),
				payload: { messageId: message.id }
			});
		} catch (err) {
			console.error("[ticketBus] messageDelete publish failed:", err);
		}
	}
}
