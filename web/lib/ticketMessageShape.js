// Shared shape mapper for ticket-channel Discord messages.
//
// Relay-from-admin tag: messages sent via the admin panel carry a single
// embed whose `author.name` looks like "<admin> · admin relay" and whose
// `description` carries the actual message body. That gives a clean header
// in Discord (no dangling empty embed) and a stable round-trip marker.

const RELAY_AUTHOR_SUFFIX = " · admin relay";

function isRelayEmbed(embed) {
	return !!(embed?.author?.name && embed.author.name.endsWith(RELAY_AUTHOR_SUFFIX));
}

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
	const relayEmbed = embeds.find(isRelayEmbed);
	const isAdminRelay = !!(msg.author?.id === botUserId && relayEmbed);
	const relayUsername = relayEmbed
		? relayEmbed.author.name.slice(0, -RELAY_AUTHOR_SUFFIX.length)
		: null;
	// When this is an admin relay, the actual message body lives in the
	// embed's description so we expose THAT as content (the top-level
	// content field on the Discord message is empty by design).
	const content = isAdminRelay
		? (relayEmbed?.description || "")
		: (msg.content || "");
	return {
		id: msg.id,
		ts: msg.createdTimestamp,
		content,
		author: {
			discordId: msg.author?.id || null,
			name: isAdminRelay && relayUsername ? relayUsername : (msg.author?.tag || "?"),
			avatarUrl: msg.author?.displayAvatarURL?.({ size: 64 }) || null,
			isBot: !!msg.author?.bot,
			isAdminRelay,
			relayUsername
		},
		attachments,
		referenceMessageId: msg.reference?.messageId || null
	};
}

module.exports = { mapMessage, RELAY_AUTHOR_SUFFIX };
