// Shared shape mapper for ticket-channel Discord messages. Both the live
// event publisher (src/events/messageCreate.ts) and the REST handler
// (web/routes/internal-tickets.js) emit messages in this exact shape so
// the admin SPA never has to branch on event source.

const RELAY_FOOTER_PREFIX = "via admin · ";

function mapMessage(msg, botUserId) {
	const attachments = msg.attachments
		? Array.from(msg.attachments.values()).map((a) => ({
			name: a.name,
			url: a.url,
			contentType: a.contentType || null,
			size: a.size || 0
		}))
		: [];
	const embeds = msg.embeds || [];
	const lastFooter = embeds.length ? embeds[embeds.length - 1]?.footer?.text || "" : "";
	const isAdminRelay = !!(msg.author?.id === botUserId && lastFooter.startsWith(RELAY_FOOTER_PREFIX));
	const relayUsername = isAdminRelay ? lastFooter.slice(RELAY_FOOTER_PREFIX.length) : null;
	return {
		id: msg.id,
		ts: msg.createdTimestamp,
		content: msg.content || "",
		author: {
			discordId: msg.author?.id || null,
			name: msg.author?.tag || "?",
			avatarUrl: msg.author?.displayAvatarURL?.({ size: 64 }) || null,
			isBot: !!msg.author?.bot,
			isAdminRelay,
			relayUsername
		},
		attachments,
		referenceMessageId: msg.reference?.messageId || null
	};
}

module.exports = { mapMessage, RELAY_FOOTER_PREFIX };
