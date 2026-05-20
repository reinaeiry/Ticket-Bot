// Helpers for turning a `tickets` row into the shape the admin web consumes.
//
// The `category` column stores the full TicketType JSON (codeName, name,
// questions[], etc.). The `reason` column stores all modal answers joined as
// "Question 1: <answer>, Question 2: <answer>, ...". The bot's Discord modal
// caps questions at 5 so the index fits comfortably.

// Split the joined reason string back into individual answers. Answer text
// can contain commas, so we split on the structural separator instead.
function splitAnswers(reasonStr) {
	if (!reasonStr) return [];
	// Leading "Question 1: " and then any "<...>, Question N: " separators.
	const parts = String(reasonStr).split(/\s*,\s*Question\s+\d+:\s+/);
	if (parts.length && /^Question\s+\d+:\s+/.test(parts[0])) {
		parts[0] = parts[0].replace(/^Question\s+\d+:\s+/, "");
	}
	return parts;
}

// Returns [{ label, value }] by zipping the questions array with the parsed
// answers. Tolerates missing/extra questions on either side.
function parseQA(categoryJson, reasonStr) {
	const answers = splitAnswers(reasonStr);
	const questions = Array.isArray(categoryJson?.questions) ? categoryJson.questions : [];
	const out = [];
	const len = Math.max(questions.length, answers.length);
	for (let i = 0; i < len; i++) {
		out.push({
			label: questions[i]?.label || `Question ${i + 1}`,
			value: answers[i] || ""
		});
	}
	return out;
}

// Extract the player's reforger GUID from a ticket's Q&A. Returns the lower-
// cased UUID if the matching question's answer parses cleanly, else null.
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function extractGuid(categoryJson, reasonStr) {
	const qa = parseQA(categoryJson, reasonStr);
	for (const { label, value } of qa) {
		if (!label || !value) continue;
		if (/arma reforger uid/i.test(label)) {
			const m = UUID_RE.exec(value);
			if (m) return m[1].toLowerCase();
		}
	}
	return null;
}

module.exports = { splitAnswers, parseQA, extractGuid };
