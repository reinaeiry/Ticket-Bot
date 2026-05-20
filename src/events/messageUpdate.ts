import { Message, PartialMessage } from "discord.js";
import { ExtendedClient } from "../structure";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ticketBus = require("../../web/lib/ticketBus");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapMessage } = require("../../web/lib/ticketMessageShape");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSupportedCode, permKeyForCode } = require("../../web/lib/ticketCategories");

// Surface edits in open tickets to the admin SPA over SSE. Partial messages
// (older messages whose cache entry has expired) refetch on demand.
export default class MessageUpdateEvent {
	private readonly client: ExtendedClient;
	constructor(client: ExtendedClient) {
		this.client = client;
	}
	public async execute(_old: Message | PartialMessage, next: Message | PartialMessage): Promise<void> {
		try {
			const m: Message = next.partial ? await next.fetch() : (next as Message);
			if (!m.guild) return;
			const ticket = await this.client.prisma.tickets.findUnique({
				where: { channelid: m.channelId }
			});
			if (!ticket || ticket.closedat) return;
			const cat = JSON.parse(ticket.category) as { codeName?: string };
			if (!cat?.codeName || !isSupportedCode(cat.codeName)) return;
			ticketBus.publish({
				type: "ticket.message.update",
				channelId: m.channelId,
				permKey: permKeyForCode(cat.codeName),
				payload: mapMessage(m, this.client.user?.id)
			});
		} catch (err) {
			console.error("[ticketBus] messageUpdate publish failed:", err);
		}
	}
}
