// Shared shape mapper for ticket-channel Discord messages.
//
// Relay-from-admin tag: messages sent via the admin panel carry a single
// embed whose `author.name` looks like "<admin> · admin relay" and whose
// `description` carries the actual message body. That gives a clean header
// in Discord (no dangling empty embed) and a stable round-trip marker.

const RELAY_AUTHOR_SUFFIX = " · admin relay";

// Account-takeover credentials must not be mirrored to the admin panel. The
// link the bot posts for /relink sits in an embed description, which this mapper
// does not carry, but a staff member re-pasting that link as plain text would be
// published live over SSE and through the internal messages API. Same pattern
// as src/utils/uploadTranscript.ts, which scrubs the transcript export.
const CREDENTIAL_PATTERN = /(console-relink[?]token=)[A-Za-z0-9_-]+/gi;

function redactCredentials(text) {
	return typeof text === "string" && text ? text.replace(CREDENTIAL_PATTERN, "$1[REDACTED]") : text;
}

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
		content: redactCredentials(content),
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
